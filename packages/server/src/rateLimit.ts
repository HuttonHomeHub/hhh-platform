// Rate limits per client IP (the real one behind the proxy, via TRUST_PROXY), written
// the same way in every app: "<n> per <second|minute|hour|day>".
import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

const UNITS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

export interface Rate {
  limit: number;
  windowMs: number;
}

export function parseRate(text: string): Rate {
  const m = /^\s*(\d+)\s*(?:per|\/)\s*(second|minute|hour|day)s?\s*$/i.exec(text);
  if (!m || Number(m[1]) < 1) throw new Error(`rate must look like "60 per minute", got "${text}"`);
  return { limit: Number(m[1]), windowMs: UNITS[(m[2] ?? '').toLowerCase()] ?? 0 };
}

export function rateLimiter(rate: Rate): RequestHandler {
  return rateLimit({
    limit: rate.limit,
    windowMs: rate.windowMs,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: 'Too many requests; wait a moment and try again' });
    },
  });
}
