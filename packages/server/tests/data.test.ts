import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MigrationError,
  RestoreError,
  backupName,
  createBackup,
  createLock,
  isBackupName,
  listBackups,
  openDatabase,
  pingDatabase,
  pruneBackups,
  readMigrations,
  restoreBackup,
  runMigrations,
  startBackupScheduler,
  userTables,
  type BackupContext,
  type Database,
} from '../src/index.ts';

const logger = pino({ level: 'silent' });
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hhh-data-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A minimal zip writer (stored entries), so tests can build archives yazl refuses to. */
function rawZip(
  entries: Array<{ name: string; data?: Buffer | string; declaredSize?: number }>
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.data ?? '');
    const name = Buffer.from(e.name);
    const crc = crc32(data);
    const size = e.declaredSize ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe('database and migrations', () => {
  async function migrationsDir(files: Record<string, string>) {
    const m = join(dir, 'migrations');
    await mkdir(m, { recursive: true });
    for (const [name, sql] of Object.entries(files)) await writeFile(join(m, name), sql);
    return m;
  }

  it('opens in WAL mode with foreign keys on', () => {
    const db = openDatabase(join(dir, 'nested', 'app.db'));
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() => pingDatabase(db)).not.toThrow();
    db.close();
    expect(() => pingDatabase(db)).toThrow();
  });

  it('applies pending migrations in order, once', async () => {
    const m = await migrationsDir({
      '002-add-label.sql': 'ALTER TABLE items ADD COLUMN label TEXT;',
      '001-init.sql': 'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);',
      'README.txt': 'not a migration',
    });
    const db = openDatabase(join(dir, 'app.db'));
    const first = runMigrations(db, { dir: m, backupDir: join(dir, 'backups'), logger });
    expect(first).toEqual({ applied: ['001-init.sql', '002-add-label.sql'] });
    expect(runMigrations(db, { dir: m, backupDir: join(dir, 'backups') }).applied).toEqual([]);
    expect(userTables(db)).toEqual(['items', 'schema_migrations']);
    db.close();
  });

  it('copies a database that holds data before migrating it', async () => {
    const m = await migrationsDir({
      '001-init.sql': 'CREATE TABLE items (id INTEGER PRIMARY KEY);',
    });
    const db = openDatabase(join(dir, 'app.db'));
    runMigrations(db, { dir: m, backupDir: join(dir, 'backups') });
    db.prepare('INSERT INTO items DEFAULT VALUES').run();
    await writeFile(join(m, '002-more.sql'), 'CREATE TABLE more (id INTEGER PRIMARY KEY);');
    const result = runMigrations(db, {
      dir: m,
      backupDir: join(dir, 'backups'),
      now: () => new Date('2026-11-16T12:00:00Z'),
    });
    expect(result.backup).toBe(join(dir, 'backups', 'premigrate-20261116T120000.db'));
    const copy = openDatabase(result.backup ?? '', { readonly: true });
    expect(copy.prepare('SELECT count(*) AS n FROM items').get()).toEqual({ n: 1 });
    expect(userTables(copy)).not.toContain('more');
    copy.close();
    db.close();
  });

  it('rolls back a failing migration and stops', async () => {
    const m = await migrationsDir({
      '001-init.sql': 'CREATE TABLE items (id INTEGER PRIMARY KEY);',
      '002-broken.sql': 'CREATE TABLE half (id INTEGER); THIS IS NOT SQL;',
    });
    const db = openDatabase(join(dir, 'app.db'));
    expect(() => runMigrations(db, { dir: m, backupDir: join(dir, 'b') })).toThrow(
      /002-broken\.sql failed/
    );
    expect(userTables(db)).not.toContain('half');
    expect(db.prepare('SELECT name FROM schema_migrations').all()).toEqual([
      { name: '001-init.sql' },
    ]);
    db.close();
  });

  it('refuses edited, misnamed or duplicate migrations', async () => {
    const m = await migrationsDir({
      '001-init.sql': 'CREATE TABLE items (id INTEGER PRIMARY KEY);',
    });
    const db = openDatabase(join(dir, 'app.db'));
    runMigrations(db, { dir: m, backupDir: join(dir, 'b') });
    await writeFile(
      join(m, '001-init.sql'),
      'CREATE TABLE items (id INTEGER PRIMARY KEY, x TEXT);'
    );
    expect(() => runMigrations(db, { dir: m, backupDir: join(dir, 'b') })).toThrow(
      /changed after it was applied/
    );
    db.close();
    await writeFile(join(m, '1-bad.sql'), '');
    expect(() => readMigrations(m)).toThrow(MigrationError);
    await rm(join(m, '1-bad.sql'));
    await writeFile(join(m, '001-again.sql'), '');
    expect(() => readMigrations(m)).toThrow(/share version 1/);
  });
});

describe('write lock', () => {
  it('runs writes one at a time, and a failure does not block the next', async () => {
    const withLock = createLock();
    const order: string[] = [];
    const slow = (name: string, ms: number) =>
      withLock(async () => {
        order.push(`${name} start`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`${name} end`);
      });
    await Promise.all([
      slow('a', 20),
      slow('b', 1),
      withLock(() => {
        throw new Error('boom');
      }).catch(() => order.push('c failed')),
      slow('d', 1),
    ]);
    expect(order).toEqual(['a start', 'a end', 'b start', 'b end', 'c failed', 'd start', 'd end']);
  });
});

describe('backups and restore', () => {
  let db: Database;
  let ctx: BackupContext;

  function setup(overrides: Partial<BackupContext['settings']> = {}) {
    const dbPath = join(dir, 'config', 'app.db');
    db = openDatabase(dbPath);
    db.exec(
      "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items (name) VALUES ('first');"
    );
    ctx = {
      settings: {
        prefix: 'app-backup',
        backupDir: join(dir, 'config', 'backups'),
        dbPath,
        uploadsDir: join(dir, 'config', 'uploads'),
        includeUploads: true,
        keep: 3,
        maxRestoreBytes: 10 * 1024 * 1024,
        requiredTables: ['items'],
        ...overrides,
      },
      withLock: createLock(),
      getDb: () => db,
    };
  }
  const hooks = () => ({
    closeDb: () => db.close(),
    openDb: () => {
      db = openDatabase(ctx.settings.dbPath);
    },
    logger,
  });
  const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name);

  afterEach(() => {
    if (db?.open) db.close();
  });

  it('names backups so only this app’s files match', () => {
    const name = backupName('app-backup', new Date('2026-11-16T03:00:00Z'));
    expect(name).toBe('app-backup-20261116-030000.zip');
    expect(isBackupName('app-backup', name)).toBe(true);
    expect(isBackupName('app-backup', 'app-backup-20261116-030000-prerestore.zip')).toBe(true);
    for (const bad of [
      '../app-backup-20261116-030000.zip',
      'other-20261116-030000.zip',
      'app-backup-x.zip',
    ]) {
      expect(isBackupName('app-backup', bad)).toBe(false);
    }
  });

  it('backs up a consistent database snapshot and the uploads, then restores both', async () => {
    setup();
    await mkdir(join(ctx.settings.uploadsDir, 'a'), { recursive: true });
    await writeFile(join(ctx.settings.uploadsDir, 'a', 'chart.pdf'), 'original pdf');
    const path = await createBackup(ctx, { now: new Date('2026-11-16T03:00:00Z') });
    expect((await listBackups(ctx.settings)).map((b) => b.name)).toEqual([
      'app-backup-20261116-030000.zip',
    ]);

    db.prepare("INSERT INTO items (name) VALUES ('after')").run();
    await writeFile(join(ctx.settings.uploadsDir, 'a', 'chart.pdf'), 'changed');
    await writeFile(join(ctx.settings.uploadsDir, 'new.pdf'), 'new');

    const result = await restoreBackup(ctx, path, hooks());
    expect(result.restoredUploads).toBe(true);
    expect(result.safetyBackup).toMatch(/^app-backup-\d{8}-\d{6}-prerestore\.zip$/);
    expect(names(db.prepare('SELECT name FROM items').all() as Array<{ name: string }>)).toEqual([
      'first',
    ]);
    expect(await readFile(join(ctx.settings.uploadsDir, 'a', 'chart.pdf'), 'utf8')).toBe(
      'original pdf'
    );
    expect(await readdir(ctx.settings.uploadsDir)).toEqual(['a']);
    expect((await readdir(join(dir, 'config'))).filter((n) => n.startsWith('.restore-'))).toEqual(
      []
    );

    // The safety backup holds the state from just before the restore, so it can be undone.
    await restoreBackup(ctx, join(ctx.settings.backupDir, result.safetyBackup), hooks());
    expect(
      names(db.prepare('SELECT name FROM items ORDER BY id').all() as Array<{ name: string }>)
    ).toEqual(['first', 'after']);
    expect(await readFile(join(ctx.settings.uploadsDir, 'new.pdf'), 'utf8')).toBe('new');
  });

  it('database-only backups leave the current uploads alone on restore', async () => {
    setup({ includeUploads: false });
    await mkdir(ctx.settings.uploadsDir, { recursive: true });
    await writeFile(join(ctx.settings.uploadsDir, 'keep.pdf'), 'keep');
    const path = await createBackup(ctx);
    const result = await restoreBackup(ctx, path, hooks());
    expect(result.restoredUploads).toBe(false);
    expect(await readFile(join(ctx.settings.uploadsDir, 'keep.pdf'), 'utf8')).toBe('keep');
  });

  it('keeps the newest backups of each kind', async () => {
    setup({ keep: 2 });
    for (const hour of ['01', '02', '03']) {
      await createBackup(ctx, { now: new Date(`2026-11-16T${hour}:00:00Z`) });
    }
    await createBackup(ctx, { label: 'prerestore', now: new Date('2026-11-16T00:30:00Z') });
    expect((await listBackups(ctx.settings)).map((b) => b.name)).toEqual([
      'app-backup-20261116-030000.zip',
      'app-backup-20261116-020000.zip',
      'app-backup-20261116-003000-prerestore.zip',
    ]);
    expect(await pruneBackups(ctx.settings)).toEqual([]);
  });

  async function rejects(zip: Buffer, message: RegExp) {
    const path = join(dir, 'upload.zip');
    await writeFile(path, zip);
    const before = names(db.prepare('SELECT name FROM items').all() as Array<{ name: string }>);
    await expect(restoreBackup(ctx, path, hooks())).rejects.toThrow(message);
    await expect(restoreBackup(ctx, path, hooks())).rejects.toBeInstanceOf(RestoreError);
    expect(names(db.prepare('SELECT name FROM items').all() as Array<{ name: string }>)).toEqual(
      before
    );
    expect(await listBackups(ctx.settings)).toEqual([]); // no safety backup: nothing was touched
  }

  it('refuses archives with unsafe or unexpected paths before touching anything', async () => {
    setup();
    await rejects(
      rawZip([
        { name: 'app.db', data: 'x' },
        { name: 'uploads/../../evil.sh', data: 'x' },
      ]),
      /not a valid backup|unsafe path/
    );
    await rejects(rawZip([{ name: '/etc/passwd', data: 'x' }]), /not a valid backup|unsafe path/);
    await rejects(
      rawZip([
        { name: 'app.db', data: 'x' },
        { name: 'notes.txt', data: 'x' },
      ]),
      /unexpected file/
    );
  });

  it('refuses archives without a usable database, or too large', async () => {
    setup();
    await rejects(rawZip([{ name: 'uploads/a.pdf', data: 'x' }]), /has no app\.db/);
    await rejects(rawZip([{ name: 'app.db', data: 'not sqlite at all' }]), /not usable/);
    const other = openDatabase(join(dir, 'other.db'));
    other.exec('CREATE TABLE unrelated (id INTEGER)');
    other.close();
    await rejects(
      rawZip([{ name: 'app.db', data: await readFile(join(dir, 'other.db')) }]),
      /missing tables: items/
    );
    ctx.settings.maxRestoreBytes = 10;
    await rejects(rawZip([{ name: 'app.db', data: 'x'.repeat(50) }]), /too large/);
    await rejects(rawZip([{ name: 'garbage' }]).subarray(0, 10), /not a valid backup/);
  });
});

describe('backup scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs first after five minutes, then every interval, and reports its status', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-16T00:00:00Z') });
    const run = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk full'));
    const scheduler = startBackupScheduler({ enabled: true, intervalHours: 24, run, logger });
    expect(scheduler.status().nextRunAt).toBe('2026-11-16T00:05:00.000Z');
    await vi.advanceTimersByTimeAsync(300_000);
    expect(run).toHaveBeenCalledOnce();
    expect(scheduler.status().lastSuccessAt).toBe('2026-11-16T00:05:00.000Z');
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(scheduler.status().lastError).toBe('disk full');
    scheduler.stop();
    expect(scheduler.status().nextRunAt).toBeUndefined();
  });

  it('does nothing when disabled', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const scheduler = startBackupScheduler({ enabled: false, intervalHours: 1, run, logger });
    vi.advanceTimersByTime(10 * 3_600_000);
    expect(run).not.toHaveBeenCalled();
    expect(scheduler.status()).toEqual({ enabled: false, intervalHours: 1 });
  });
});

describe('backup files on disk', () => {
  it('leave no partial or snapshot files behind', async () => {
    const dbPath = join(dir, 'app.db');
    const db = openDatabase(dbPath);
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY)');
    const ctx: BackupContext = {
      settings: {
        prefix: 'x',
        backupDir: join(dir, 'b'),
        dbPath,
        uploadsDir: join(dir, 'missing-uploads'),
        includeUploads: true,
        keep: 5,
        maxRestoreBytes: 1e6,
        requiredTables: ['items'],
      },
      withLock: createLock(),
      getDb: () => db,
    };
    const path = await createBackup(ctx);
    expect((await stat(path)).size).toBeGreaterThan(0);
    expect(await readdir(join(dir, 'b'))).toEqual([path.split('/').pop()]);
    db.close();
  });
});
