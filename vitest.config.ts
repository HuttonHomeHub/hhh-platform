import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';
import { hhhVitest } from './packages/config/vitest.ts';

export default mergeConfig(
  hhhVitest({
    include: ['tests/**/*.test.{ts,tsx}', 'packages/*/tests/**/*.test.{ts,tsx}'],
    coverageInclude: [
      'scripts/**/*.ts',
      'packages/*/src/**/*.{ts,tsx}',
      'packages/config/vitest.ts',
    ],
  }),
  defineConfig({ plugins: [react()] })
);
