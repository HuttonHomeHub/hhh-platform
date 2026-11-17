import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { hhhThemeInit, THEME_INIT_URL, themeInitPath } from '../vite.ts';

type Hook = (this: unknown, ...args: unknown[]) => unknown;

/** A plugin hook as a function (Vite hooks are a function or `{ handler }`). */
function hookOf(hook: unknown): Hook {
  if (typeof hook === 'function') return hook as Hook;
  if (hook && typeof hook === 'object' && 'handler' in hook) return hook.handler as Hook;
  throw new Error('the plugin has no such hook');
}

/** A fake app with @hhh/ui installed, so resolution is tested the way apps use it. */
function fakeApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'hhh-vite-'));
  writeFileSync(join(root, 'package.json'), '{"name":"app","type":"module"}');
  const ui = join(root, 'node_modules', '@hhh', 'ui');
  mkdirSync(ui, { recursive: true });
  writeFileSync(
    join(ui, 'package.json'),
    JSON.stringify({ name: '@hhh/ui', exports: { './theme-init.js': './theme-init.js' } })
  );
  writeFileSync(join(ui, 'theme-init.js'), '/* theme */');
  return root;
}

describe('hhhThemeInit', () => {
  it('finds theme-init.js in the app that installed @hhh/ui', () => {
    const root = fakeApp();
    expect(themeInitPath(root)).toBe(join(root, 'node_modules', '@hhh', 'ui', 'theme-init.js'));
  });

  it('adds the script tag first in <head>', () => {
    const plugin = hhhThemeInit({ path: join(fakeApp(), 'node_modules/@hhh/ui/theme-init.js') });
    expect(hookOf(plugin.transformIndexHtml).call(undefined)).toEqual([
      { tag: 'script', attrs: { src: THEME_INIT_URL }, injectTo: 'head-prepend' },
    ]);
  });

  it('emits the script beside index.html in the build', () => {
    const plugin = hhhThemeInit({ path: join(fakeApp(), 'node_modules/@hhh/ui/theme-init.js') });
    const emitFile = vi.fn();
    hookOf(plugin.generateBundle).call({ emitFile });
    expect(emitFile).toHaveBeenCalledWith({
      type: 'asset',
      fileName: 'theme-init.js',
      source: '/* theme */',
    });
  });

  it('serves the script in dev', () => {
    const plugin = hhhThemeInit({ path: join(fakeApp(), 'node_modules/@hhh/ui/theme-init.js') });
    let route = '';
    let handler: (
      req: unknown,
      res: { setHeader: (k: string, v: string) => void; end: (b: string) => void }
    ) => void = () => {};
    const server = {
      middlewares: {
        use: (path: string, fn: typeof handler) => {
          route = path;
          handler = fn;
        },
      },
    };
    hookOf(plugin.configureServer).call(undefined, server);
    const res = { setHeader: vi.fn(), end: vi.fn() };
    handler({}, res);
    expect(route).toBe(THEME_INIT_URL);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/javascript');
    expect(res.end).toHaveBeenCalledWith('/* theme */');
  });
});
