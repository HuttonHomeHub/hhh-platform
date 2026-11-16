import { hhhConfig } from './packages/config/eslint.js';

// The UI package's components, tests and showcase run in the browser, as does
// theme-init.js (before first paint); everything else is Node.
const browser = ['packages/ui/{src,tests,showcase}/**/*.{ts,tsx}', 'packages/ui/theme-init.js'];

export default hhhConfig({
  browser,
  react: ['packages/ui/{src,tests,showcase}/**/*.tsx'],
  node: [
    'scripts/**/*.ts',
    'tests/**/*.ts',
    'packages/*/src/**/*.ts',
    'packages/server/tests/**/*.ts',
    '*.config.{js,ts}',
  ],
});
