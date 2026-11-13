import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import de from './i18n/de.json';
import en from './i18n/en.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string'
      ? { ...acc, [path]: value }
      : { ...acc, ...flatten(value, path) };
  }, {});
}

const flatDe = flatten(de as Tree);
const flatEn = flatten(en as Tree);
const placeholders = (text: string) =>
  [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  it('de.json and en.json contain the same keys', () => {
    expect(Object.keys(flatDe).sort()).toEqual(Object.keys(flatEn).sort());
  });

  it('have no empty texts and use the same placeholders in both languages', () => {
    for (const key of Object.keys(flatDe)) {
      expect(flatDe[key], `de: ${key}`).not.toBe('');
      expect(flatEn[key], `en: ${key}`).not.toBe('');
      expect(placeholders(flatEn[key] as string), key).toEqual(placeholders(flatDe[key] as string));
    }
  });

  it('follow the tone of the design system: no exclamation marks, no emoji', () => {
    for (const text of [...Object.values(flatDe), ...Object.values(flatEn)]) {
      expect(text).not.toContain('!');
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('use the names of the design system', () => {
    expect(flatDe['dialog.newTitle']).toBe('Neue Rechnung');
    expect(flatEn['dialog.newTitle']).toBe('New claim');
    expect(flatDe['status.OPEN']).toBe('Offen');
    expect(flatDe['field.notRecognised']).toBe('Nicht erkannt');
    expect(flatEn['field.notRecognised']).toBe('Not recognised');
  });
});

describe('bank data', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(ts|html|json)$/.test(name) && !name.endsWith('.spec.ts') ? [path] : [];
    });
  }

  it('is never mentioned in the app: no IBAN, BIC or account number in code, templates or texts', () => {
    const root = join(__dirname, '.');
    for (const file of sourceFiles(root)) {
      if (file.includes('/testing/')) continue;
      expect(readFileSync(file, 'utf8'), file).not.toMatch(
        /\b(iban|bic|kontonummer|account number)\b/i,
      );
    }
  });
});
