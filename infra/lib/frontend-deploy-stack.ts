import * as cdk from 'aws-cdk-lib';
import type * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FRONTEND_DIST_DIR, PLACEHOLDER_SITE_DIR, REGION } from './config';

export interface FrontendDeployStackProps extends cdk.StackProps {
  siteBucket: s3.IBucket;
  distribution: cloudfront.IDistribution;
  apiUrl: string;
  userPool: cognito.UserPool;
  userPoolClient: cognito.IUserPoolClient;
  userPoolDomain: cognito.UserPoolDomain;
}

/**
 * Uploads the Angular build and the generated config.json, then invalidates CloudFront.
 * Runs last because config.json needs the outputs of the Auth and Api stacks.
 * Without a frontend build (before the app exists) a small placeholder page is deployed.
 */
export class FrontendDeployStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FrontendDeployStackProps) {
    super(scope, id, props);

    const hasBuild = fs.existsSync(path.join(FRONTEND_DIST_DIR, 'index.html'));

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      destinationBucket: props.siteBucket,
      sources: [
        s3deploy.Source.asset(hasBuild ? FRONTEND_DIST_DIR : PLACEHOLDER_SITE_DIR),
        // The app reads this at runtime, so no build-time environment files are needed.
        s3deploy.Source.jsonData('config.json', {
          region: REGION,
          apiUrl: props.apiUrl,
          userPoolId: props.userPool.userPoolId,
          clientId: props.userPoolClient.userPoolClientId,
          authority: props.userPool.userPoolProviderUrl,
          hostedUiUrl: props.userPoolDomain.baseUrl(),
        }),
      ],
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=0, must-revalidate')],
      prune: true,
      distribution: props.distribution,
      distributionPaths: ['/*'],
    });
  }
}
