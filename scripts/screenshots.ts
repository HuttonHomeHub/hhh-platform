// Screenshots of the component showcase in both themes, for review and for the
// component catalogue (docs/screenshots). Needs a built showcase (npm run showcase).
// Runs in the Playwright image, so no browser is installed on the dev box:
//   docker run --rm --user 1000:1000 -e HOME=/tmp -v "$PWD":/app -w /app \
//     mcr.microsoft.com/playwright:v1.65.1-noble node scripts/screenshots.ts
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const DIST = join(root, 'packages', 'ui', 'showcase', 'dist');
const OUT = join(root, 'docs', 'screenshots');

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

/** A static file server for the built showcase, confined to its folder. */
export function serve(dir: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const file = normalize(join(dir, path === '/' ? 'index.html' : path));
    if (!file.startsWith(dir + sep)) {
      res.writeHead(403).end();
      return;
    }
    readFile(file)
      .then((body) =>
        res
          .writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
          .end(body)
      )
      .catch(() => res.writeHead(404).end());
  });
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      done({ server, url: `http://127.0.0.1:${port}/` });
    })
  );
}

const SHOTS = [
  { view: 'components', width: 1280, height: 900, fullPage: true },
  { view: 'settings', width: 1280, height: 900, fullPage: false },
  { view: 'confirm', width: 1280, height: 720, fullPage: false },
  { view: 'toast', width: 1280, height: 720, fullPage: false },
  { view: 'components', width: 390, height: 844, fullPage: false, name: 'mobile' },
] as const;

export async function main(): Promise<number> {
  const { server, url } = await serve(DIST);
  const browser = await chromium.launch();
  try {
    for (const theme of ['light', 'dark'] as const) {
      for (const shot of SHOTS) {
        const page = await browser.newPage({
          viewport: { width: shot.width, height: shot.height },
        });
        const errors: string[] = [];
        page.on('pageerror', (err) => errors.push(err.message));
        page.on('console', (msg) => {
          if (msg.type() === 'error') errors.push(msg.text());
        });
        await page.goto(`${url}?theme=${theme}&view=${shot.view}`);
        await page.evaluate('document.fonts.ready'); // runs in the page
        await page.waitForTimeout(300);
        if (errors.length) throw new Error(`${shot.view}/${theme}: ${errors.join('; ')}`);
        const file = join(OUT, `${'name' in shot ? shot.name : shot.view}-${theme}.png`);
        await page.screenshot({ path: file, fullPage: shot.fullPage });
        console.warn(`wrote ${file}`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
