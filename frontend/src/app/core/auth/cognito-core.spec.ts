import { describe, expect, it } from 'vitest';
import { AuthError, mapCognitoError } from './auth-error';
import { CognitoAuthCore, type TokenStore } from './cognito-core';

interface Call {
  target: string;
  body: Record<string, unknown>;
}

/** A fake Cognito: answers with the queued replies in order and records what was sent. */
function setup(now = { t: 1_000_000 }) {
  const calls: Call[] = [];
  const replies: (Record<string, unknown> | Error)[] = [];
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({
      target: headers['X-Amz-Target']!.replace('AWSCognitoIdentityProviderService.', ''),
      body: JSON.parse(init.body as string),
    });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    if (next && typeof next['status'] === 'number') {
      const failed = next as { status: number; body: unknown };
      return new Response(JSON.stringify(failed.body), { status: failed.status });
    }
    return new Response(JSON.stringify(next ?? {}), { status: 200 });
  }) as unknown as typeof fetch;

  let stored: string | null = null;
  const store: TokenStore = {
    read: () => stored,
    write: (v) => (stored = v),
    clear: () => (stored = null),
  };
  const core = new CognitoAuthCore(
    { region: 'eu-central-1', clientId: 'client-1' },
    store,
    fakeFetch,
    () => now.t,
  );
  return { core, calls, replies, now, store, stored: () => stored };
}

const tokens = (extra: { ExpiresIn?: number } = {}) => ({
  AuthenticationResult: {
    AccessToken: 'access-1',
    RefreshToken: 'refresh-1',
    ExpiresIn: 3600,
    ...extra,
  },
});
const failure = (type: string) => ({
  status: 400,
  body: { __type: type, message: 'internal text' },
});

describe('sign in', () => {
  it('signs in with USER_PASSWORD_AUTH and stores the tokens', async () => {
    const { core, calls, replies, stored } = setup();
    replies.push(tokens());
    expect(await core.signIn(' me@example.test ', 'secret-password')).toBe('done');
    expect(calls[0]).toEqual({
      target: 'InitiateAuth',
      body: {
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: 'client-1',
        AuthParameters: { USERNAME: 'me@example.test', PASSWORD: 'secret-password' },
      },
    });
    expect(core.isSignedIn()).toBe(true);
    expect(await core.accessToken()).toBe('access-1');
    // the password is never stored
    expect(stored()).not.toContain('secret-password');
    expect(JSON.parse(stored()!)).toMatchObject({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
  });

  it('walks through the new-password challenge of an invited user', async () => {
    const { core, calls, replies } = setup();
    replies.push({
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      Session: 'session-1',
      ChallengeParameters: { USER_ID_FOR_SRP: 'resolved-user' },
    });
    expect(await core.signIn('me@example.test', 'temporary')).toBe('newPassword');
    expect(core.isSignedIn()).toBe(false);

    replies.push(tokens());
    expect(await core.completeNewPassword('A-much-longer-Password1')).toBe('done');
    expect(calls[1]).toEqual({
      target: 'RespondToAuthChallenge',
      body: {
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        ClientId: 'client-1',
        Session: 'session-1',
        ChallengeResponses: { USERNAME: 'resolved-user', NEW_PASSWORD: 'A-much-longer-Password1' },
      },
    });
    expect(core.isSignedIn()).toBe(true);
  });

  it('walks through the authenticator code and strips spaces', async () => {
    const { core, calls, replies } = setup();
    replies.push({ ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 'session-2' });
    expect(await core.signIn('me@example.test', 'secret-password')).toBe('mfa');
    replies.push(tokens());
    expect(await core.submitMfaCode('123 456')).toBe('done');
    expect(calls[1]?.body['ChallengeResponses']).toEqual({
      USERNAME: 'me@example.test',
      SOFTWARE_TOKEN_MFA_CODE: '123456',
    });
  });

  it('refuses a challenge answer without the matching challenge', async () => {
    const { core } = setup();
    await expect(core.completeNewPassword('x')).rejects.toMatchObject({ code: 'session_expired' });
    await expect(core.submitMfaCode('123456')).rejects.toMatchObject({ code: 'session_expired' });
  });

  it('rejects challenges the app does not offer', async () => {
    const { core, replies } = setup();
    replies.push({ ChallengeName: 'MFA_SETUP', Session: 's' });
    await expect(core.signIn('me@example.test', 'pw')).rejects.toMatchObject({ code: 'unknown' });
  });

  it('maps errors to friendly codes and never exposes the Cognito message', async () => {
    const { core, replies } = setup();
    replies.push(failure('NotAuthorizedException'));
    const error = await core.signIn('me@example.test', 'wrong').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).code).toBe('invalid_credentials');
    expect((error as AuthError).message).not.toContain('internal text');

    replies.push(failure('TooManyRequestsException'));
    await expect(core.signIn('me@example.test', 'wrong')).rejects.toMatchObject({
      code: 'rate_limited',
    });

    replies.push(new TypeError('Failed to fetch'));
    await expect(core.signIn('me@example.test', 'pw')).rejects.toMatchObject({ code: 'network' });
  });

  it('keeps the challenge after a wrong code and drops it when the session ran out', async () => {
    const { core, replies } = setup();
    replies.push({ ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 's' });
    await core.signIn('me@example.test', 'pw');
    replies.push(failure('CodeMismatchException'));
    await expect(core.submitMfaCode('000000')).rejects.toMatchObject({ code: 'invalid_code' });
    replies.push(failure('NotAuthorizedException'));
    await expect(core.submitMfaCode('111111')).rejects.toMatchObject({ code: 'session_expired' });
  });
});

describe('error mapping', () => {
  it('knows the namespaced error types of Cognito', () => {
    expect(mapCognitoError('com.amazonaws.cognito#NotAuthorizedException', 'signIn')).toBe(
      'invalid_credentials',
    );
    expect(mapCognitoError('NotAuthorizedException', 'challenge')).toBe('session_expired');
    expect(mapCognitoError('InvalidParameterException', 'challenge')).toBe('password_policy');
    expect(mapCognitoError('InvalidParameterException', 'signIn')).toBe('unknown');
    expect(mapCognitoError('ExpiredCodeException', 'confirm')).toBe('expired_code');
    expect(mapCognitoError(undefined, 'signIn')).toBe('unknown');
  });
});

describe('password reset', () => {
  it('requests the code and confirms with code and new password', async () => {
    const { core, calls } = setup();
    await core.requestPasswordReset(' me@example.test ');
    await core.confirmPasswordReset('me@example.test', ' 123456 ', 'A-much-longer-Password1');
    expect(calls[0]).toEqual({
      target: 'ForgotPassword',
      body: { ClientId: 'client-1', Username: 'me@example.test' },
    });
    expect(calls[1]?.body).toMatchObject({
      Username: 'me@example.test',
      ConfirmationCode: '123456',
      Password: 'A-much-longer-Password1',
    });
  });

  it('answers the same for an unknown address (no account guessing)', async () => {
    const { core, replies } = setup();
    replies.push(failure('UserNotFoundException'));
    await expect(core.requestPasswordReset('nobody@example.test')).resolves.toBeUndefined();
    replies.push(failure('LimitExceededException'));
    await expect(core.requestPasswordReset('me@example.test')).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });
});

describe('session', () => {
  it('restores a stored session without a request while the token is fresh', async () => {
    const first = setup();
    first.replies.push(tokens());
    await first.core.signIn('me@example.test', 'pw');

    const second = setup(first.now);
    second.store.write(first.stored()!);
    expect(await second.core.restore()).toBe(true);
    expect(second.calls).toHaveLength(0);
  });

  it('renews an expiring token once, even for parallel requests, and keeps the refresh token', async () => {
    const { core, calls, replies, now } = setup();
    replies.push(tokens());
    await core.signIn('me@example.test', 'pw');
    now.t += 3600_000 - 30_000; // 30 seconds left, under the one minute margin

    replies.push({ AuthenticationResult: { AccessToken: 'access-2', ExpiresIn: 3600 } });
    const [a, b] = await Promise.all([core.accessToken(), core.accessToken()]);
    expect([a, b]).toEqual(['access-2', 'access-2']);
    expect(calls.filter((c) => c.body['AuthFlow'] === 'REFRESH_TOKEN_AUTH')).toHaveLength(1);
    expect(calls.at(-1)?.body['AuthParameters']).toEqual({ REFRESH_TOKEN: 'refresh-1' });
  });

  it('ends the session when the refresh token is no longer accepted', async () => {
    const { core, replies, now, stored } = setup();
    let lost = 0;
    core.onSessionLost = () => lost++;
    replies.push(tokens());
    await core.signIn('me@example.test', 'pw');
    now.t += 3600_000;
    replies.push(failure('NotAuthorizedException'));
    expect(await core.accessToken()).toBeNull();
    expect(core.isSignedIn()).toBe(false);
    expect(stored()).toBeNull();
    expect(lost).toBe(1);
  });

  it('keeps the session when the refresh fails only because the network is down', async () => {
    const { core, replies, now } = setup();
    replies.push(tokens());
    await core.signIn('me@example.test', 'pw');
    now.t += 3600_000 - 30_000;
    replies.push(new TypeError('offline'));
    expect(await core.accessToken()).toBe('access-1');
    expect(core.isSignedIn()).toBe(true);
  });

  it('signs out locally even if revoking fails, and revokes the refresh token otherwise', async () => {
    const ok = setup();
    ok.replies.push(tokens());
    await ok.core.signIn('me@example.test', 'pw');
    await ok.core.signOut();
    expect(ok.calls.at(-1)).toEqual({
      target: 'RevokeToken',
      body: { ClientId: 'client-1', Token: 'refresh-1' },
    });
    expect(ok.core.isSignedIn()).toBe(false);
    expect(ok.stored()).toBeNull();

    const offline = setup();
    offline.replies.push(tokens());
    await offline.core.signIn('me@example.test', 'pw');
    offline.replies.push(new TypeError('offline'));
    await offline.core.signOut();
    expect(offline.core.isSignedIn()).toBe(false);
  });

  it('ignores a damaged stored session', async () => {
    const { core, store } = setup();
    store.write('{"accessToken": 1}');
    expect(await core.restore()).toBe(false);
    expect(store.read()).toBeNull();
  });
});
