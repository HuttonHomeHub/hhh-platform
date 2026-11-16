import { hhhVitest } from './packages/config/vitest.ts';

export default hhhVitest({
  coverageInclude: ['scripts/**/*.ts', 'packages/*/src/**/*.{ts,tsx}', 'packages/config/vitest.ts'],
});
