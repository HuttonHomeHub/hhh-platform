// Graceful shutdown: on SIGTERM or SIGINT stop accepting connections, let in-flight
// requests finish, run onClose (e.g. close the database), then exit. A timer forces
// the exit if a connection holds on longer than timeoutMs.
import type { Server } from 'node:http';
import type { Logger } from './logger.ts';

export interface ShutdownOptions {
  logger: Logger;
  onClose?: () => void | Promise<void>;
  timeoutMs?: number;
  signals?: NodeJS.Signals[];
  exit?: (code: number) => void;
}

/** Wires the signals and returns the shutdown function (also handy in tests). */
export function gracefulShutdown(
  server: Server,
  options: ShutdownOptions
): (signal: string) => Promise<void> {
  const {
    logger,
    onClose,
    timeoutMs = 10_000,
    signals = ['SIGTERM', 'SIGINT'],
    exit = process.exit,
  } = options;
  let started = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (started) return;
    started = true;
    logger.info(`${signal} received, shutting down`);
    const force = setTimeout(() => {
      logger.error('Shutdown timed out, forcing exit');
      exit(1);
    }, timeoutMs);
    force.unref();
    try {
      await new Promise<void>((done, fail) => server.close((err) => (err ? fail(err) : done())));
      await onClose?.();
      clearTimeout(force);
      logger.info('Shutdown complete');
      exit(0);
    } catch (err) {
      clearTimeout(force);
      logger.error({ err }, 'Error during shutdown');
      exit(1);
    }
  };
  for (const signal of signals) process.once(signal, () => void shutdown(signal));
  return shutdown;
}
