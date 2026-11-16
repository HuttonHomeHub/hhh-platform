// JSON-line logging with pino. One line per request with method, path, status,
// duration and a request id, and nothing else from the request (no headers or
// cookies), so logs stay small and free of session tokens.
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pino, type Logger } from 'pino';
import { pinoHttp, type HttpLogger } from 'pino-http';
import type { LogLevel } from './settings.ts';

export type { Logger } from 'pino';

export function createLogger(options: { level: LogLevel; name: string }): Logger {
  return pino({ name: options.name, level: options.level });
}

export function requestId(): string {
  return randomBytes(8).toString('hex');
}

export function httpLogger(logger: Logger): HttpLogger {
  return pinoHttp({
    logger,
    genReqId: (req, res) => {
      const id = requestId();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    serializers: {
      req: (req: IncomingMessage & { id?: unknown }) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req, res, err) =>
      err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    // Health probes every 30 s would drown everything else.
    autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
  });
}
