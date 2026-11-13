/** Reasons a sign-in step can fail. The UI shows a friendly text per code, never Cognito's own message. */
export type AuthErrorCode =
  | 'invalid_credentials'
  | 'invalid_code'
  | 'expired_code'
  | 'password_policy'
  | 'password_reset_required'
  | 'rate_limited'
  | 'session_expired'
  | 'network'
  | 'unknown';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
  }
}

/** Which call failed, because Cognito reuses error types with different meanings. */
export type AuthContext = 'signIn' | 'challenge' | 'forgot' | 'confirm';

/** Cognito answers with `__type` such as "NotAuthorizedException" (sometimes prefixed with a namespace and `#`). */
export function mapCognitoError(rawType: unknown, context: AuthContext): AuthErrorCode {
  const type = typeof rawType === 'string' ? (rawType.split('#').pop() ?? '') : '';
  switch (type) {
    case 'NotAuthorizedException':
      // In a challenge this means the 3 minute session ran out or was used up.
      return context === 'challenge' ? 'session_expired' : 'invalid_credentials';
    case 'UserNotFoundException':
      return 'invalid_credentials';
    case 'CodeMismatchException':
      return 'invalid_code';
    case 'ExpiredCodeException':
      return 'expired_code';
    case 'InvalidPasswordException':
      return 'password_policy';
    case 'InvalidParameterException':
      // Too short, wrong characters: Cognito reports weak passwords this way on these two calls.
      return context === 'challenge' || context === 'confirm' ? 'password_policy' : 'unknown';
    case 'PasswordResetRequiredException':
      return 'password_reset_required';
    case 'LimitExceededException':
    case 'TooManyRequestsException':
    case 'TooManyFailedAttemptsException':
      return 'rate_limited';
    default:
      return 'unknown';
  }
}
