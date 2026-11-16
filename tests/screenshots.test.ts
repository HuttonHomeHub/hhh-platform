import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serve } from '../scripts/screenshots.ts';

let dir: string;
let url: string;
let close: () => void;

// A raw request, so a path like /../x reaches the server unnormalised.
function get(path: string): Promise<{ status: number; type: string | undefined; body: string }> {
  return new Promise((done, fail) => {
    const req = request(new URL(url), { path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () =>
        done({ status: res.statusCode ?? 0, type: res.headers['content-type'], body })
      );
    });
    req.on('error', fail);
    req.end();
  });
}

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'hhh-serve-'));
  dir = join(root, 'dist');
  await mkdir(join(dir, 'assets'), { recursive: true });
  await writeFile(join(dir, 'index.html'), '<p>showcase</p>');
  await writeFile(join(dir, 'assets', 'app.css'), 'body{}');
  await writeFile(join(root, 'secret.txt'), 'outside');
  const started = await serve(dir);
  url = started.url;
  close = () => started.server.close();
});

afterAll(async () => {
  close();
  await rm(join(dir, '..'), { recursive: true, force: true });
});

describe('showcase file server', () => {
  it('serves index.html at / and files with their content type', async () => {
    expect(await get('/')).toMatchObject({
      status: 200,
      type: 'text/html',
      body: '<p>showcase</p>',
    });
    expect(await get('/assets/app.css')).toMatchObject({ status: 200, type: 'text/css' });
  });

  it('answers 404 for missing files and refuses paths outside its folder', async () => {
    expect((await get('/nope.js')).status).toBe(404);
    // URL parsing already removes ../ segments, so these stay inside the folder (404)...
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt']) {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(res.body).not.toContain('outside');
    }
    // ...but an encoded slash survives it and is decoded afterwards: the folder check refuses it.
    const encoded = await get('/..%2fsecret.txt');
    expect(encoded.status).toBe(403);
    expect(encoded.body).not.toContain('outside');
  });
});
