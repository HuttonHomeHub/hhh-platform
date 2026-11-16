import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import express from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  HttpError,
  createBaseApp,
  finishApp,
  parseRate,
  rateLimiter,
} from '../src/index.ts';

function capture() {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      for (const line of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(line));
      done();
    },
  });
  return { logger: pino({ level: 'info' }, stream), lines };
}

function makeApp(opts: { trustProxyHops?: number; ready?: () => void } = {}) {
  const { logger, lines } = capture();
  const app = createBaseApp({
    logger,
    version: '1.2.3',
    trustProxyHops: opts.trustProxyHops ?? 0,
    csp: { imgSrc: ['https://tiles.example.com'] },
    jsonLimit: '1kb',
    ...(opts.ready ? { ready: opts.ready } : {}),
  });
  app.get('/api/ip', (req, res) => {
    res.json({ ip: req.ip });
  });
  app.post('/api/echo', (req, res) => {
    res.status(201).json(z.object({ name: z.string() }).parse(req.body));
  });
  app.get('/api/gone', () => {
    throw new HttpError(410, 'That crane was deleted');
  });
  app.get('/api/boom', () => {
    throw new Error('secret stack detail');
  });
  app.get('/api/http-error', () => {
    throw Object.assign(new Error('Range Not Satisfiable'), { statusCode: 416 });
  });
  app.get('/api/server-status', () => {
    throw Object.assign(new Error('upstream detail'), { status: 503 });
  });
  app.get('/api/too-big', () => {
    throw Object.assign(new Error('File too large'), { code: 'LIMIT_FILE_SIZE' });
  });
  app.get('/api/async-boom', async () => {
    await Promise.resolve();
    throw new Error('async failure');
  });
  app.get('/', (_req, res) => {
    res.send(`nonce=${res.locals.cspNonce}`);
  });
  finishApp(app, logger);
  return { app, lines };
}

async function csrfToken(app: express.Express): Promise<string> {
  const res = await request(app).get('/api/ip');
  const cookie = ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith(CSRF_COOKIE));
  return (cookie ?? '').split(';')[0]?.split('=')[1] ?? '';
}

describe('health routes', () => {
  it('report liveness, readiness and the version', async () => {
    const { app } = makeApp();
    expect((await request(app).get('/health')).body).toEqual({ status: 'ok', version: '1.2.3' });
    expect((await request(app).get('/version')).body).toEqual({ version: '1.2.3' });
    expect((await request(app).get('/ready')).body).toEqual({ status: 'ready' });
  });

  it('/ready answers 503 when the check fails', async () => {
    const { app } = makeApp({
      ready: () => {
        throw new Error('db gone');
      },
    });
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });
});

describe('security headers', () => {
  it('sends a strict CSP with a fresh nonce per request, and hides the framework', async () => {
    const { app } = makeApp();
    const a = await request(app).get('/');
    const b = await request(app).get('/');
    const nonceA = a.text.replace('nonce=', '');
    expect(a.headers['content-security-policy']).toContain(`script-src 'self' 'nonce-${nonceA}'`);
    expect(a.headers['content-security-policy']).toContain("object-src 'none'");
    expect(a.headers['content-security-policy']).toContain(
      "img-src 'self' data: blob: https://tiles.example.com"
    );
    expect(a.headers['content-security-policy']).not.toContain('unsafe-eval');
    expect(b.text).not.toBe(a.text);
    expect(a.headers['x-content-type-options']).toBe('nosniff');
    expect(a.headers['x-powered-by']).toBeUndefined();
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('CSRF', () => {
  it('issues a cookie on first visit and requires it back in the header for writes', async () => {
    const { app } = makeApp();
    const first = await request(app).get('/api/ip');
    expect(String(first.headers['set-cookie'])).toMatch(
      new RegExp(`${CSRF_COOKIE}=[0-9a-f]{64}; Path=/; SameSite=Strict`)
    );
    const token = await csrfToken(app);

    const missing = await request(app).post('/api/echo').send({ name: 'x' });
    expect(missing.status).toBe(403);
    expect(missing.body.error).toContain('CSRF');

    const wrong = await request(app)
      .post('/api/echo')
      .set('Cookie', `${CSRF_COOKIE}=${token}`)
      .set('X-CSRF-Token', 'nope')
      .send({ name: 'x' });
    expect(wrong.status).toBe(403);

    const ok = await request(app)
      .post('/api/echo')
      .set('Cookie', `other=1; ${CSRF_COOKIE}=${token}`)
      .set('X-CSRF-Token', token)
      .send({ name: 'Liebherr' });
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ name: 'Liebherr' });
  });

  it('marks the cookie Secure when the request came over HTTPS through a trusted proxy', async () => {
    const { app } = makeApp({ trustProxyHops: 1 });
    const res = await request(app).get('/api/ip').set('X-Forwarded-Proto', 'https');
    expect(String(res.headers['set-cookie'])).toContain('; Secure');
  });
});

describe('errors', () => {
  async function post(app: express.Express, body: string) {
    const token = await csrfToken(app);
    return request(app)
      .post('/api/echo')
      .set('Cookie', `${CSRF_COOKIE}=${token}`)
      .set('X-CSRF-Token', token)
      .set('Content-Type', 'application/json')
      .send(body);
  }

  it('are always JSON, and say what was wrong when it was the request', async () => {
    const { app } = makeApp();
    expect((await request(app).get('/api/gone')).body).toEqual({ error: 'That crane was deleted' });
    expect((await request(app).get('/api/nothing-here')).body).toEqual({ error: 'Not found' });
    const invalid = await post(app, '{"name": 5}');
    expect(invalid.status).toBe(400);
    expect(invalid.body.details[0].path).toBe('name');
    expect((await post(app, '{oops')).body).toEqual({ error: 'Request body is not valid JSON' });
    const big = await post(app, JSON.stringify({ name: 'x'.repeat(2000) }));
    expect(big.status).toBe(413);
  });

  it("pass on a library error's own 4xx status, and an upload over its size limit as 413", async () => {
    const { app } = makeApp();
    const ranged = await request(app).get('/api/http-error');
    expect(ranged.status).toBe(416);
    expect(ranged.body).toEqual({ error: 'Range Not Satisfiable' });
    const upload = await request(app).get('/api/too-big');
    expect(upload.status).toBe(413);
    expect(upload.body).toEqual({ error: 'File is too large' });
    // A 5xx status is still unexpected: generic message, nothing leaked.
    const upstream = await request(app).get('/api/server-status');
    expect(upstream.status).toBe(500);
    expect(upstream.body).toEqual({ error: 'Internal server error' });
  });

  it('use the same CSRF cookie and header names as apiFetch in @hhh/ui', () => {
    // Read as text: @hhh/ui is browser code, outside this (Node) TypeScript project.
    const ui = readFileSync(new URL('../../ui/src/api.ts', import.meta.url), 'utf8');
    expect(ui).toContain(`export const CSRF_COOKIE = '${CSRF_COOKIE}';`);
    expect(ui.toLowerCase()).toContain(`export const csrf_header = '${CSRF_HEADER}';`);
  });

  it('hide unexpected errors behind a generic message and log them with the stack', async () => {
    const { app, lines } = makeApp();
    for (const path of ['/api/boom', '/api/async-boom']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });
      expect(JSON.stringify(res.body)).not.toContain('secret');
    }
    const logged = lines.filter((l) => l.msg === 'Unhandled error');
    expect(logged).toHaveLength(2);
    expect(JSON.stringify(logged[0])).toContain('secret stack detail');
  });
});

describe('proxy trust and request logs', () => {
  it('uses the client IP from the trusted hops only', async () => {
    const xff = '203.0.113.7, 172.71.0.1';
    const none = makeApp({ trustProxyHops: 0 }).app;
    const one = makeApp({ trustProxyHops: 1 }).app;
    const two = makeApp({ trustProxyHops: 2 }).app;
    expect((await request(none).get('/api/ip').set('X-Forwarded-For', xff)).body.ip).not.toBe(
      '203.0.113.7'
    );
    expect((await request(one).get('/api/ip').set('X-Forwarded-For', xff)).body.ip).toBe(
      '172.71.0.1'
    );
    expect((await request(two).get('/api/ip').set('X-Forwarded-For', xff)).body.ip).toBe(
      '203.0.113.7'
    );
  });

  it('logs one small line per request, without headers, and skips health probes', async () => {
    const { app, lines } = makeApp();
    await request(app).get('/health');
    await request(app).get('/api/ip').set('Cookie', 'session=secret-token');
    const requestLines = lines.filter((l) => l.req);
    expect(requestLines).toHaveLength(1);
    expect(requestLines[0]?.req).toEqual({ id: expect.any(String), method: 'GET', url: '/api/ip' });
    expect(JSON.stringify(lines)).not.toContain('secret-token');
  });
});

describe('rate limits', () => {
  it('parses the standard form', () => {
    expect(parseRate('60 per minute')).toEqual({ limit: 60, windowMs: 60_000 });
    expect(parseRate('5/second')).toEqual({ limit: 5, windowMs: 1000 });
    expect(parseRate('1000 per hours')).toEqual({ limit: 1000, windowMs: 3_600_000 });
    expect(parseRate('1000 per 15 minutes')).toEqual({ limit: 1000, windowMs: 900_000 });
    expect(parseRate('10/2 seconds')).toEqual({ limit: 10, windowMs: 2000 });
    expect(() => parseRate('5 per 0 minutes')).toThrow('1000 per 15 minutes');
    expect(() => parseRate('lots')).toThrow('60 per minute');
    expect(() => parseRate('0 per minute')).toThrow();
  });

  it('answers 429 in JSON once the limit is reached, with RateLimit headers', async () => {
    const app = express();
    app.get('/x', rateLimiter(parseRate('2 per minute')), (_req, res) => {
      res.json({ ok: true });
    });
    expect((await request(app).get('/x')).headers['ratelimit-policy']).toBeDefined();
    await request(app).get('/x');
    const third = await request(app).get('/x');
    expect(third.status).toBe(429);
    expect(third.body.error).toContain('Too many requests');
  });
});
