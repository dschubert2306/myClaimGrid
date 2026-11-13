import { describe, expect, it } from 'vitest';
import { sanitizeReturnTo } from './return-to';

describe('sanitizeReturnTo', () => {
  it('keeps in-app paths', () => {
    expect(sanitizeReturnTo('/')).toBe('/');
    expect(sanitizeReturnTo('/?year=2025')).toBe('/?year=2025');
  });

  it('never redirects to another site or back into the login flow', () => {
    for (const value of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/login',
      '/login?notice=error',
      '/auth/callback?code=x',
      '',
      null,
      undefined,
    ]) {
      expect(sanitizeReturnTo(value)).toBe('/');
    }
  });
});
