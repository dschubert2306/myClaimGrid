import * as cdk from 'aws-cdk-lib';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ApiStack } from './api-stack';
import { AuthStack } from './auth-stack';
import { INFRA_DIR, LOCAL_DEV_ORIGIN, REGION } from './config';
import { FrontendDeployStack } from './frontend-deploy-stack';
import { FrontendStack } from './frontend-stack';
import { OpsStack } from './ops-stack';
import { StorageStack } from './storage-stack';

function readScriptHashes(): string[] {
  const file = path.join(INFRA_DIR, 'csp-script-hashes.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as string[];
}

/**
 * Stack order (no circular references):
 * Frontend (bucket, distribution) -> Storage -> Auth -> Api -> FrontendDeploy (config.json, content) and Ops.
 */
export function createApp(context: Record<string, unknown> = {}): cdk.App {
  const app = new cdk.App({ context });
  // The account comes from the credentials of whoever runs cdk, it is never written to the repository.
  const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: REGION };

  const localCallback = String(app.node.tryGetContext('localCallback') ?? 'true') !== 'false';
  const alertEmail = (app.node.tryGetContext('alertEmail') as string | undefined) || undefined;
  const domainPrefix =
    (app.node.tryGetContext('cognitoDomainPrefix') as string | undefined) || undefined;
  const budgetLimitUsd = Number(app.node.tryGetContext('budgetLimitUsd') ?? 10);

  const frontend = new FrontendStack(app, 'myclaimgrid-frontend', {
    env,
    cspScriptHashes: readScriptHashes(),
  });
  const appOrigins = [frontend.origin, ...(localCallback ? [LOCAL_DEV_ORIGIN] : [])];

  const storage = new StorageStack(app, 'myclaimgrid-storage', { env, allowedOrigins: appOrigins });
  const auth = new AuthStack(app, 'myclaimgrid-auth', { env, appOrigins, domainPrefix });
  const api = new ApiStack(app, 'myclaimgrid-api', {
    env,
    table: storage.table,
    invoicesBucketName: storage.invoicesBucket.bucketName,
    invoicesBucketArn: storage.invoicesBucket.bucketArn,
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
    corsOrigins: appOrigins,
  });
  new FrontendDeployStack(app, 'myclaimgrid-frontend-deploy', {
    env,
    siteBucket: frontend.bucket,
    distribution: frontend.distribution,
    apiUrl: api.httpApi.apiEndpoint,
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
    userPoolDomain: auth.userPoolDomain,
  });
  new OpsStack(app, 'myclaimgrid-ops', {
    env,
    extractionFunction: api.extractionFunction,
    alertEmail,
    budgetLimitUsd,
  });

  return app;
}
