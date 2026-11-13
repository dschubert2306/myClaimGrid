import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

export interface StorageStackProps extends cdk.StackProps {
  /** Origins that may upload to and read from the bucket from the browser. */
  allowedOrigins: string[];
}

export const GSI_BY_CLAIM_ID = 'byClaimId';

export class StorageStack extends cdk.Stack {
  readonly invoicesBucket: s3.Bucket;
  readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    // Health data: both resources are kept when the stack is deleted.
    this.invoicesBucket = new s3.Bucket(this, 'InvoicesBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.POST, s3.HttpMethods.GET],
          allowedOrigins: props.allowedOrigins,
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'expire-noncurrent-versions',
          // Deleting an invoice only adds a delete marker, so old versions must expire.
          noncurrentVersionExpiration: cdk.Duration.days(30),
          expiredObjectDeleteMarker: true,
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
    });

    this.table = new dynamodb.Table(this, 'Table', {
      tableName: 'myclaimgrid',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    this.table.addGlobalSecondaryIndex({
      indexName: GSI_BY_CLAIM_ID,
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
  }
}
