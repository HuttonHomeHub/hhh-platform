import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hhhConfig } from '../packages/config/eslint.js';
import prettier from '../packages/config/prettier.js';
import { COVERAGE_LINES, hhhVitest } from '../packages/config/vitest.ts';

describe('@hhh/config', () => {
  it('tsconfig is strict, with the standard extra checks', async () => {
    const raw = await readFile(
      resolve(import.meta.dirname, '../packages/config/tsconfig.base.json'),
      'utf8'
    );
    const { compilerOptions } = JSON.parse(raw);
    expect(compilerOptions).toMatchObject({
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      erasableSyntaxOnly: true,
    });
  });

  it('prettier matches the house style', () => {
    expect(prettier).toEqual({
      semi: true,
      singleQuote: true,
      tabWidth: 2,
      trailingComma: 'es5',
      printWidth: 100,
    });
  });

  it('eslint config bans any and default exports, and adds browser globals on request', () => {
    const config = hhhConfig({ browser: ['src/**/*.tsx'] });
    const rules = Object.assign({}, ...config.map((c) => c.rules ?? {}));
    expect(rules['@typescript-eslint/no-explicit-any']).toBe('error');
    expect(rules.eqeqeq).toEqual(['error', 'always', { null: 'ignore' }]);
    expect(rules['no-restricted-exports']).toBeDefined();
    const browser = config.find((c) => c.files?.includes('src/**/*.tsx'));
    expect(browser?.languageOptions?.globals).toHaveProperty('window');
    expect(config[0]?.ignores).toContain('vendor/**');
  });

  it('vitest preset gates coverage at 80% of lines', () => {
    const cfg = hhhVitest({ coverageInclude: ['src/**/*.ts'] });
    expect(COVERAGE_LINES).toBe(80);
    expect(cfg.test?.coverage).toMatchObject({
      thresholds: { lines: 80 },
      include: ['src/**/*.ts'],
    });
    expect(cfg.test?.include).toEqual(['tests/**/*.test.{ts,tsx}']);
  });
});
