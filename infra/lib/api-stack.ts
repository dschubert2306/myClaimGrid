import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import type { Construct } from 'constructs';
import * as path from 'node:path';
import { BACKEND_HANDLERS_DIR, REPO_ROOT } from './config';

export interface ApiStackProps extends cdk.StackProps {
  table: dynamodb.ITable;
  /** Passed as plain attributes so the notification below lives in this stack (avoids a cross-stack cycle). */
  invoicesBucketName: string;
  invoicesBucketArn: string;
  userPool: cognito.UserPool;
  userPoolClient: cognito.IUserPoolClient;
  corsOrigins: string[];
}

export class ApiStack extends cdk.Stack {
  readonly httpApi: apigwv2.HttpApi;
  readonly extractionFunction: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const bucket = s3.Bucket.fromBucketAttributes(this, 'InvoicesBucket', {
      bucketName: props.invoicesBucketName,
      bucketArn: props.invoicesBucketArn,
    });
    const uploadsArn = bucket.arnForObjects('uploads/*');
    // Insurer documents: staged on upload (expire after a day), moved next to the claim on save.
    const stagingArn = bucket.arnForObjects('incoming/*');
    const insurerArn = bucket.arnForObjects('insurer/*');

    const createFunction = (
      name: string,
      entry: string,
      props2: { timeout?: cdk.Duration; memorySize?: number } = {},
    ) =>
      new nodejs.NodejsFunction(this, name, {
        entry: path.join(BACKEND_HANDLERS_DIR, entry),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: props2.memorySize ?? 256,
        timeout: props2.timeout ?? cdk.Duration.seconds(10),
        projectRoot: REPO_ROOT,
        depsLockFilePath: path.join(REPO_ROOT, 'package-lock.json'),
        environment: {
          TABLE_NAME: props.table.tableName,
          BUCKET_NAME: props.invoicesBucketName,
          NODE_OPTIONS: '--enable-source-maps',
        },
        logGroup: new logs.LogGroup(this, `${name}Logs`, {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        bundling: {
          minify: true,
          sourceMap: true,
          target: 'node22',
          // Bundle the AWS SDK too (s3-presigned-post is not part of the Lambda runtime).
          externalModules: [],
        },
      });

    const personsFn = createFunction('PersonsFunction', 'persons.ts');
    const claimsFn = createFunction('ClaimsFunction', 'claims.ts');
    const dashboardFn = createFunction('DashboardFunction', 'dashboard.ts');
    const reimbursementFn = createFunction('ReimbursementFunction', 'reimbursement.ts');
    this.extractionFunction = createFunction('ExtractionFunction', 'extract.ts', {
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
    });

    // Least privilege per function: only the DynamoDB actions and S3 prefixes each one uses.
    props.table.grant(personsFn, 'dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:PutItem');
    props.table.grant(dashboardFn, 'dynamodb:Query');
    props.table.grant(
      claimsFn,
      'dynamodb:Query',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:DeleteItem',
    );
    props.table.grant(this.extractionFunction, 'dynamodb:Query', 'dynamodb:PutItem');
    props.table.grant(reimbursementFn, 'dynamodb:Query', 'dynamodb:PutItem');

    // Presigned URLs are signed with the role of the function, so it needs the permission itself.
    claimsFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
        resources: [uploadsArn],
      }),
    );
    // Deleting a claim removes its insurer documents too. Nothing else of that prefix.
    claimsFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['s3:DeleteObject'], resources: [insurerArn] }),
    );
    this.extractionFunction.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['s3:GetObject'], resources: [uploadsArn] }),
    );
    // Presigned POST into staging (PutObject), check and copy (GetObject covers HeadObject and the
    // copy source), signed links and deletion. No access to the invoices under uploads/.
    reimbursementFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
        resources: [stagingArn, insurerArn],
      }),
    );
    // Textract has no resource level permissions for AnalyzeExpense.
    this.extractionFunction.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['textract:AnalyzeExpense'], resources: ['*'] }),
    );

    // Upload -> extraction.
    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(this.extractionFunction),
      { prefix: 'uploads/', suffix: '.pdf' },
    );

    // HTTP API. Every route requires a valid Cognito JWT, there is no unauthenticated route.
    const authorizer = new HttpJwtAuthorizer('CognitoJwt', props.userPool.userPoolProviderUrl, {
      jwtAudience: [props.userPoolClient.userPoolClientId],
    });
    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'myclaimgrid',
      defaultAuthorizer: authorizer,
      corsPreflight: {
        allowOrigins: props.corsOrigins,
        allowHeaders: ['authorization', 'content-type'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
        ],
        maxAge: cdk.Duration.hours(1),
      },
    });
    // Cost guard: a single user never needs more than this.
    const stage = this.httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = { throttlingBurstLimit: 20, throttlingRateLimit: 10 };

    const M = apigwv2.HttpMethod;
    const routes: [apigwv2.HttpMethod, string, lambda.IFunction][] = [
      [M.GET, '/persons', personsFn],
      [M.PUT, '/persons/{id}', personsFn],
      [M.GET, '/persons/{id}/claims', claimsFn],
      [M.POST, '/uploads', claimsFn],
      [M.POST, '/claims', claimsFn],
      [M.GET, '/claims/{id}', claimsFn],
      [M.PUT, '/claims/{id}', claimsFn],
      [M.DELETE, '/claims/{id}', claimsFn],
      [M.POST, '/claims/{id}/documents', reimbursementFn],
      [M.POST, '/claims/{id}/entries', reimbursementFn],
      [M.DELETE, '/claims/{id}/entries/{entryId}', reimbursementFn],
      [M.DELETE, '/claims/{id}/documents/{documentId}', reimbursementFn],
      [M.GET, '/claims/{id}/documents/{documentId}/url', reimbursementFn],
      [M.GET, '/dashboard', dashboardFn],
    ];
    for (const [method, routePath, fn] of routes) {
      this.httpApi.addRoutes({
        path: routePath,
        methods: [method],
        integration: new HttpLambdaIntegration(`${method}${routePath.replace(/\W+/g, '-')}`, fn),
      });
    }

    new cdk.CfnOutput(this, 'ApiUrl', { value: this.httpApi.apiEndpoint });
  }
}
