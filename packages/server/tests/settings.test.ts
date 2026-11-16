import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  SettingsError,
  loadSettings,
  parseTrustProxy,
  resolveDataPaths,
  sharedSettings,
} from '../src/index.ts';

const shape = { ...sharedSettings, BACKUP_KEEP: z.coerce.number().int().positive().default(7) };

describe('settings', () => {
  it('applies the standard defaults', () => {
    const { settings, deprecated } = loadSettings(shape, { env: {} });
    expect(settings).toMatchObject({
      LOG_LEVEL: 'info',
      TRUST_PROXY: 0,
      APP_VERSION: 'dev',
      BACKUP_KEEP: 7,
    });
    expect(settings.DATA_DIR).toBeUndefined();
    expect(deprecated).toEqual([]);
  });

  it('reads standard names, falls back to old names, and the new name wins', () => {
    const { settings, deprecated } = loadSettings(shape, {
      env: {
        DB_PATH: '/new.db',
        PHOTOS_DB_PATH: '/old.db',
        CRANE_BACKUP_KEEP: '3',
        TRUST_PROXY: '2',
      },
      legacy: { DB_PATH: 'PHOTOS_DB_PATH', BACKUP_KEEP: 'CRANE_BACKUP_KEEP' },
    });
    expect(settings.DB_PATH).toBe('/new.db');
    expect(settings.BACKUP_KEEP).toBe(3);
    expect(settings.TRUST_PROXY).toBe(2);
    expect(deprecated).toEqual([['CRANE_BACKUP_KEEP', 'BACKUP_KEEP']]);
  });

  it('treats an empty value as unset', () => {
    expect(loadSettings(shape, { env: { LOG_LEVEL: '' } }).settings.LOG_LEVEL).toBe('info');
  });

  it('stops startup listing every bad value', () => {
    let error: unknown;
    try {
      loadSettings(shape, {
        env: { LOG_LEVEL: 'loud', TRUST_PROXY: 'loopback', BACKUP_KEEP: '0' },
      });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(SettingsError);
    const problems = (error as SettingsError).problems.join('\n');
    expect(problems).toContain('LOG_LEVEL');
    expect(problems).toContain('TRUST_PROXY: must be a hop count');
    expect(problems).toContain('BACKUP_KEEP');
  });

  it('parses proxy hop counts', () => {
    expect([' 0 ', 'false', 'off', 'true', '1', '2'].map(parseTrustProxy)).toEqual([
      0, 0, 0, 1, 1, 2,
    ]);
    expect(() => parseTrustProxy('10.0.0.0/8')).toThrow('hop count');
  });

  it('puts the database and uploads inside DATA_DIR unless set', () => {
    const opts = { dbFile: 'app.db', fallbackDir: '/srv/app', join };
    expect(resolveDataPaths({ DATA_DIR: '/config' }, opts)).toEqual({
      dataDir: '/config',
      dbPath: '/config/app.db',
      uploadsDir: '/config/uploads',
    });
    expect(resolveDataPaths({ DB_PATH: '/db/x.db', UPLOADS_DIR: '/pics' }, opts)).toEqual({
      dataDir: '/srv/app',
      dbPath: '/db/x.db',
      uploadsDir: '/pics',
    });
  });
});
