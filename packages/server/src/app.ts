// The common front and back of every app's Express server, so the order of
// middleware is the same everywhere:
//   const app = createBaseApp({ ... });      // proxy, security, logging, JSON, health, CSRF
//   app.use('/api/cranes', cranesRouter);     // the app's own routes
//   finishApp(app, logger);                   // JSON 404 for /api, the error handler
import compression from 'compression';
import express, { type Express } from 'express';
import { csrf } from './csrf.ts';
import { errorHandler, notFound } from './errors.ts';
import { healthRoutes } from './health.ts';
import { httpLogger, type Logger } from './logger.ts';
import { cspNonce, securityHeaders, type CspOptions } from './security.ts';

export interface BaseAppOptions {
  logger: Logger;
  version: string;
  /** Proxy hops in front (TRUST_PROXY); 0 = none. */
  trustProxyHops: number;
  ready?: () => void | Promise<void>;
  csp?: CspOptions;
  /** Largest JSON body accepted (uploads use their own limits). */
  jsonLimit?: string;
}

export function createBaseApp(options: BaseAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', options.trustProxyHops > 0 ? options.trustProxyHops : false);
  app.use(cspNonce, securityHeaders(options.csp));
  app.use(compression());
  app.use(httpLogger(options.logger));
  app.use(
    healthRoutes({ version: options.version, ...(options.ready ? { ready: options.ready } : {}) })
  );
  app.use(express.json({ limit: options.jsonLimit ?? '1mb' }));
  app.use(csrf);
  return app;
}

export function finishApp(app: Express, logger: Logger): void {
  app.use('/api', notFound);
  app.use(errorHandler(logger));
}
