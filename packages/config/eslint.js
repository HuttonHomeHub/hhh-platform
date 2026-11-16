// Shared ESLint flat config. Apps call it from their eslint.config.js and add only
// what is genuinely app-specific (e.g. eslint-plugin-react), with a comment saying why.
//
//   import { hhhConfig } from '@hhh/config/eslint';
//   export default hhhConfig({ browser: ['src/**/*.{ts,tsx}'], node: ['server/**/*.ts'] });
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * @param {{ browser?: string[], node?: string[], ignores?: string[] }} [options]
 */
export function hhhConfig(options = {}) {
  const { browser = [], node = ['**/*.ts'], ignores = [] } = options;
  return tseslint.config(
    {
      ignores: [
        '**/node_modules/**',
        '**/dist/**',
        '**/dist-release/**',
        '**/coverage/**',
        'vendor/**',
        ...ignores,
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.strict,
    {
      rules: {
        // Named exports only (the standard), except config files tools load by default export.
        'no-restricted-exports': ['error', { restrictDefaultExports: { direct: true } }],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/ban-ts-comment': [
          'error',
          { 'ts-expect-error': 'allow-with-description' },
        ],
        eqeqeq: ['error', 'always'],
        'no-console': ['error', { allow: ['warn', 'error'] }],
      },
    },
    {
      files: ['**/*.config.{js,ts}', '**/eslint.js', '**/prettier.js', '**/vitest.ts'],
      rules: { 'no-restricted-exports': 'off' },
    },
    ...(browser.length ? [{ files: browser, languageOptions: { globals: globals.browser } }] : []),
    ...(node.length ? [{ files: node, languageOptions: { globals: globals.node } }] : [])
  );
}
