import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { createApp } from '../lib/app';

// Skip esbuild bundling in tests, the template is what matters here.
const baseContext = { 'aws:cdk:bundling-stacks': [] };

function build(context: Record<string, unknown> = {}) {
  const app = createApp({ ...baseContext, ...context });
  const stack = (name: string) =>
    Template.fromStack(app.node.findChild(`myclaimgrid-${name}`) as never);
  return { app, stack };
}

const { stack } = build();

describe('StorageStack', () => {
  const template = stack('storage');

  it('keeps invoices private, encrypted, versioned and TLS only', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      VersioningConfiguration: { Status: 'Enabled' },
      BucketEncryption: Match.objectLike({
        ServerSideEncryptionConfiguration: [
          Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }),
        ],
      }),
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  it('expires noncurrent versions after 30 days and allows POST and GET from the app origin', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: [
          Match.objectLike({
            NoncurrentVersionExpiration: { NoncurrentDays: 30 },
            Status: 'Enabled',
          }),
        ],
      },
      CorsConfiguration: {
        CorsRules: [Match.objectLike({ AllowedMethods: ['POST', 'GET'] })],
      },
    });
  });

  it('retains the bucket and the table', () => {
    for (const type of ['AWS::S3::Bucket', 'AWS::DynamoDB::Table']) {
      const resources = template.findResources(type);
      for (const resource of Object.values(resources)) {
        expect(resource.DeletionPolicy).toBe('Retain');
      }
    }
  });

  it('has an on-demand table with point in time recovery and the byClaimId index', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'myclaimgrid',
      BillingMode: 'PAY_PER_REQUEST',
      DeletionProtectionEnabled: true,
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [Match.objectLike({ IndexName: 'byClaimId' })],
    });
  });
});

describe('AuthStack', () => {
  const template = stack('auth');

  it('disables self sign-up and uses a public client that allows the password sign-in of the login page', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      MfaConfiguration: 'OPTIONAL',
      EnabledMfas: ['SOFTWARE_TOKEN_MFA'],
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AllowedOAuthFlows: ['code'],
      AllowedOAuthFlowsUserPoolClient: true,
      // USER_PASSWORD_AUTH for the login page, the refresh token flow is always on. No SRP, no admin flows.
      ExplicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
    });
  });

  it('uses the LoginPage routes for the callback and the logout redirect, locally and on CloudFront', () => {
    const [client] = Object.values(template.findResources('AWS::Cognito::UserPoolClient'));
    const callbacks = client?.Properties.CallbackURLs as unknown[];
    const logouts = client?.Properties.LogoutURLs as unknown[];
    expect(callbacks).toHaveLength(2);
    expect(logouts).toHaveLength(2);
    expect(callbacks).toContain('http://localhost:4200/auth/callback');
    expect(logouts).toContain('http://localhost:4200/login');
    // The CloudFront origin is a cross-stack token, so look at the joined string parts.
    expect(JSON.stringify(callbacks)).toContain('/auth/callback');
    expect(JSON.stringify(logouts)).toContain('/login');
  });
});

describe('ApiStack', () => {
  const template = stack('api');

  it('protects every route with the JWT authorizer', () => {
    const routes = Object.values(template.findResources('AWS::ApiGatewayV2::Route'));
    expect(routes).toHaveLength(9);
    for (const route of routes) {
      expect(route.Properties.AuthorizationType).toBe('JWT');
      expect(route.Properties.AuthorizerId).toBeDefined();
    }
  });

  it('runs Node.js 22 functions with 30 day log retention', () => {
    const functions = Object.values(template.findResources('AWS::Lambda::Function')).filter(
      (f) => f.Properties.Environment?.Variables?.TABLE_NAME !== undefined, // our four, not CDK's helper
    );
    expect(functions).toHaveLength(4);
    for (const fn of functions) expect(fn.Properties.Runtime).toBe('nodejs22.x');
    const groups = Object.values(template.findResources('AWS::Logs::LogGroup'));
    expect(groups).toHaveLength(4);
    for (const group of groups) expect(group.Properties.RetentionInDays).toBe(30);
  });

  it('wires the upload prefix to the extraction function', () => {
    const [resource] = Object.values(template.findResources('Custom::S3BucketNotifications'));
    const configs = resource?.Properties.NotificationConfiguration.LambdaFunctionConfigurations;
    expect(configs).toHaveLength(1);
    expect(configs[0].Events).toEqual(['s3:ObjectCreated:*']);
    const rules = configs[0].Filter.Key.FilterRules as { Name: string; Value: string }[];
    expect(Object.fromEntries(rules.map((r) => [r.Name, r.Value]))).toEqual({
      prefix: 'uploads/',
      suffix: '.pdf',
    });
  });

  it('gives the functions narrow permissions, with a wildcard resource only for Textract', () => {
    const policies = Object.entries(template.findResources('AWS::IAM::Policy')).filter(([id]) =>
      /Function.*ServiceRoleDefaultPolicy/.test(id),
    );
    expect(policies).toHaveLength(4);
    for (const [, policy] of policies) {
      const statements = policy.Properties.PolicyDocument.Statement as {
        Action: string | string[];
        Resource: unknown;
      }[];
      for (const statement of statements) {
        const actions = ([] as string[]).concat(statement.Action);
        expect(actions.some((a) => a.endsWith(':*'))).toBe(false);
        if (statement.Resource === '*') expect(actions).toEqual(['textract:AnalyzeExpense']);
      }
    }
  });
});

describe('FrontendStack', () => {
  const template = stack('frontend');

  it('sends strict security headers without external hosts', () => {
    const policies = Object.values(
      template.findResources('AWS::CloudFront::ResponseHeadersPolicy'),
    );
    const config = policies[0]?.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig;
    const csp = config.ContentSecurityPolicy.ContentSecurityPolicy as string;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toMatch(/unsafe-eval|googleapis|gstatic/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(config.StrictTransportSecurity.Override).toBe(true);
    expect(config.ContentTypeOptions.Override).toBe(true);
  });

  it('keeps the site bucket private and falls back to index.html', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicPolicy: true }),
    });
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        CustomErrorResponses: [
          Match.objectLike({ ErrorCode: 403, ResponsePagePath: '/index.html', ResponseCode: 200 }),
          Match.objectLike({ ErrorCode: 404, ResponsePagePath: '/index.html', ResponseCode: 200 }),
        ],
      }),
    });
  });
});

describe('OpsStack', () => {
  it('always has the extraction alarm and creates a budget only with an alert email', () => {
    const without = stack('ops');
    without.resourceCountIs('AWS::CloudWatch::Alarm', 1);
    without.resourceCountIs('AWS::Budgets::Budget', 0);

    const withEmail = build({ alertEmail: 'alerts@example.invalid', budgetLimitUsd: 5 }).stack(
      'ops',
    );
    withEmail.resourceCountIs('AWS::Budgets::Budget', 1);
    withEmail.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({ BudgetLimit: { Amount: 5, Unit: 'USD' } }),
    });
  });
});
