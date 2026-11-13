import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

export interface AuthStackProps extends cdk.StackProps {
  /** Origins of the SPA, for example https://dxxxx.cloudfront.net and http://localhost:4200 */
  appOrigins: string[];
  /** Optional override. The default is "myclaimgrid-<account id>", which is globally unique. */
  domainPrefix?: string;
}

export class AuthStack extends cdk.Stack {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly userPoolDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'myclaimgrid',
      // One user is created manually by the owner (see README), nobody can sign up.
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: false } },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.userPoolDomain = this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: props.domainPrefix ?? `myclaimgrid-${cdk.Aws.ACCOUNT_ID}` },
    });

    this.userPoolClient = this.userPool.addClient('SpaClient', {
      userPoolClientName: 'myclaimgrid-spa',
      generateSecret: false, // public client, protected by PKCE
      authFlows: {}, // no direct password flows, only the hosted UI with the authorization code flow
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        // Routes of the LoginPage flow (design-system/components/LoginPage): the OIDC callback
        // and the page signed-out users land on, also after signing out at Cognito.
        callbackUrls: props.appOrigins.map((origin) => `${origin}/auth/callback`),
        logoutUrls: props.appOrigins.map((origin) => `${origin}/login`),
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'HostedUiUrl', { value: this.userPoolDomain.baseUrl() });
  }
}
