import { createServer } from 'node:http';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { gracefulShutdown } from '../src/index.ts';

const logger = pino({ level: 'silent' });

describe('graceful shutdown', () => {
  it('closes the server, runs onClose, then exits 0, once', async () => {
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, done));
    const onClose = vi.fn();
    const exit = vi.fn();
    const shutdown = gracefulShutdown(server, { logger, onClose, exit, signals: [] });
    await shutdown('SIGTERM');
    await shutdown('SIGTERM');
    expect(server.listening).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('exits 1 if closing fails', async () => {
    const server = createServer(); // never listened: close() reports an error
    const exit = vi.fn();
    await gracefulShutdown(server, { logger, exit, signals: [] })('SIGINT');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('forces exit 1 when a connection holds on past the timeout', async () => {
    vi.useFakeTimers();
    const server = { close: () => undefined } as unknown as Parameters<typeof gracefulShutdown>[0];
    const exit = vi.fn();
    void gracefulShutdown(server, { logger, exit, timeoutMs: 50, signals: [] })('SIGTERM');
    vi.advanceTimersByTime(60);
    expect(exit).toHaveBeenCalledWith(1);
    vi.useRealTimers();
  });

  it('wires the signals it is given', () => {
    const once = vi.spyOn(process, 'once');
    gracefulShutdown(createServer(), { logger, exit: vi.fn(), signals: ['SIGUSR2'] });
    expect(once).toHaveBeenCalledWith('SIGUSR2', expect.any(Function));
    process.removeAllListeners('SIGUSR2');
    once.mockRestore();
  });
});
