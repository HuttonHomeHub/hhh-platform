// Generates packages/ui/styles/tokens.css from packages/ui/src/tokens.ts.
//   node scripts/build-tokens.ts          write the file
//   node scripts/build-tokens.ts --check  exit 1 if the file is out of date
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { breakpoints, colors, scale, type ColorTokens } from '../packages/ui/src/tokens.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TOKENS_CSS = join(root, 'packages', 'ui', 'styles', 'tokens.css');

function declarations(vars: Record<string, string>, indent: string): string {
  return Object.entries(vars)
    .map(([name, value]) => `${indent}--${name}: ${value};`)
    .join('\n');
}

function themeBlock(tokens: ColorTokens, scheme: 'light' | 'dark', indent: string): string {
  return `${declarations({ ...tokens }, indent)}\n${indent}color-scheme: ${scheme};`;
}

export function renderTokensCss(): string {
  return `/* GENERATED from packages/ui/src/tokens.ts by scripts/build-tokens.ts. Do not edit:
 * change tokens.ts and run \`npm run tokens\`. Light is the default; dark applies when the
 * system prefers it (unless the user picked light) or when the user picked dark. */

:root {
${declarations(scale, '  ')}
  --bp-mobile: ${breakpoints.mobile};
  --bp-tablet: ${breakpoints.tablet};
  --border-focus: var(--accent);
${themeBlock(colors.light, 'light', '  ')}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${themeBlock(colors.dark, 'dark', '    ')}
  }
}

:root[data-theme='dark'] {
${themeBlock(colors.dark, 'dark', '  ')}
}
`;
}

export async function main(args: string[]): Promise<number> {
  const css = renderTokensCss();
  if (args.includes('--check')) {
    const current = await readFile(TOKENS_CSS, 'utf8').catch(() => '');
    if (current === css) return 0;
    console.error('packages/ui/styles/tokens.css is out of date: run `npm run tokens`');
    return 1;
  }
  await writeFile(TOKENS_CSS, css);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
