import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { TOKENS_CSS, main as tokensMain, renderTokensCss } from '../scripts/build-tokens.ts';
import {
  CONTRAST_MIN,
  THEMES,
  THEME_STORAGE_KEY,
  applyThemeChoice,
  colors,
  contrastRatio,
  effectiveTheme,
  luminance,
  nextTheme,
  readThemeChoice,
  textPairs,
} from '../packages/ui/src/index.ts';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (n: string, v: string) => void attrs.set(n, v),
    removeAttribute: (n: string) => void attrs.delete(n),
  };
}

const blocked = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(() => luminance('rgba(0,0,0,1)')).toThrow('#RRGGBB');
  });

  for (const theme of THEMES) {
    it(`every text pair meets ${CONTRAST_MIN}:1 in ${theme}`, () => {
      const failures = textPairs
        .map(([fg, bg]) => ({ fg, bg, ratio: contrastRatio(colors[theme][fg], colors[theme][bg]) }))
        .filter((p) => p.ratio < CONTRAST_MIN)
        .map((p) => `${p.fg} on ${p.bg}: ${p.ratio.toFixed(2)}`);
      expect(failures).toEqual([]);
    });
  }

  it('checks every text colour against every background it may sit on', () => {
    expect(textPairs).toHaveLength(3 * 4 + 5 * 3 + 2);
  });
});

describe('tokens.css', () => {
  it('is up to date with tokens.ts', async () => {
    expect(await readFile(TOKENS_CSS, 'utf8')).toBe(renderTokensCss());
    expect(await tokensMain(['--check'])).toBe(0);
  });

  it('defines both themes, light by default, dark by system or pick', () => {
    const css = renderTokensCss();
    expect(css).toContain(`--accent: ${colors.light.accent};`);
    expect(css).toContain(`--accent: ${colors.dark.accent};`);
    expect(css).toContain(
      "@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light'])"
    );
    expect(css).toContain(":root[data-theme='dark'] {");
  });
});

describe('theme choice', () => {
  it('defaults to following the system, and survives blocked storage', () => {
    expect(readThemeChoice(memoryStorage())).toBe('system');
    expect(readThemeChoice(memoryStorage({ [THEME_STORAGE_KEY]: 'bogus' }))).toBe('system');
    expect(readThemeChoice(undefined)).toBe('system');
    expect(readThemeChoice(blocked)).toBe('system');
    expect(readThemeChoice(memoryStorage({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark');
  });

  it('applies and remembers a pick, and clears it for system', () => {
    const storage = memoryStorage();
    const root = fakeRoot();
    applyThemeChoice('dark', root, storage);
    expect(root.attrs.get('data-theme')).toBe('dark');
    expect(storage.data.get(THEME_STORAGE_KEY)).toBe('dark');
    applyThemeChoice('system', root, storage);
    expect(root.attrs.has('data-theme')).toBe(false);
    expect(storage.data.has(THEME_STORAGE_KEY)).toBe(false);
    applyThemeChoice('light', root, blocked); // still applies with storage blocked
    expect(root.attrs.get('data-theme')).toBe('light');
    applyThemeChoice('system', root, blocked);
    expect(root.attrs.has('data-theme')).toBe(false);
  });

  it('toggles from what is shown now', () => {
    expect(effectiveTheme('system', true)).toBe('dark');
    expect(effectiveTheme('system', false)).toBe('light');
    expect(effectiveTheme('light', true)).toBe('light');
    expect(nextTheme('system', true)).toBe('light');
    expect(nextTheme('system', false)).toBe('dark');
    expect(nextTheme('dark', false)).toBe('light');
  });

  it('theme-init.js applies a stored pick before paint and ignores anything else', async () => {
    const code = await readFile(
      resolve(import.meta.dirname, '../packages/ui/theme-init.js'),
      'utf8'
    );
    for (const [stored, expected] of [
      ['dark', 'dark'],
      ['light', 'light'],
      ['x', undefined],
      [null, undefined],
    ] as const) {
      const root = fakeRoot();
      const storage = memoryStorage(stored ? { [THEME_STORAGE_KEY]: stored } : {});
      runInNewContext(code, { localStorage: storage, document: { documentElement: root } });
      expect(root.attrs.get('data-theme')).toBe(expected);
    }
    const root = fakeRoot();
    runInNewContext(code, { localStorage: blocked, document: { documentElement: root } });
    expect(root.attrs.size).toBe(0);
  });
});
