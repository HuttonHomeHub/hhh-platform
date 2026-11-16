// Every error leaves the server as JSON {"error": "..."}: the browser hook depends on it.
// Expected errors (HttpError, validation, bad JSON, too large) say what was wrong;
// anything unexpected is logged with its stack and answered "Internal server error",
// never with the exception's own text.
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from './logger.ts';

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export const notFound: RequestHandler = (_req, _res, next) => next(new HttpError(404, 'Not found'));

interface BodyParserError extends Error {
  type?: string;
  status?: number;
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({
        error: 'Invalid request',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }
    const parserError = err as BodyParserError;
    if (parserError?.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request is too large' });
      return;
    }
    if (parserError?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Request body is not valid JSON' });
      return;
    }
    (req.log ?? logger).error({ err }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  };
}
