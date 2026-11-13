import { describe, expect, it } from 'vitest';
import { initialLang } from './locale';
import { isThemeChoice, resolveTheme } from './theme';

describe('initialLang', () => {
  it('uses the stored choice first', () => {
    expect(initialLang('en', 'de-DE')).toBe('en');
    expect(initialLang('de', 'en-US')).toBe('de');
  });

  it('falls back to the browser language, English otherwise', () => {
    expect(initialLang(null, 'de-AT')).toBe('de');
    expect(initialLang(null, 'en-US')).toBe('en');
    expect(initialLang(null, 'fr-FR')).toBe('en');
    expect(initialLang('xx', undefined)).toBe('en');
  });
});

describe('theme', () => {
  it('resolves light, dark and system', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('only accepts the three choices from storage', () => {
    expect(['light', 'system', 'dark'].every(isThemeChoice)).toBe(true);
    expect(isThemeChoice('blue')).toBe(false);
    expect(isThemeChoice(null)).toBe(false);
  });
});
