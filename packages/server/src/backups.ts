// Backups and restore, the same in every app.
//
// A backup is one zip: a consistent snapshot of the database (SQLite's online backup
// API, safe while the app runs) plus, unless includeUploads is off, the uploads
// folder. Written as <prefix>-YYYYMMDD-HHMMSS[-label].zip into backupDir, then pruned
// to `keep` per kind (scheduled, prerestore ...).
//
// A restore never touches live data until the archive has passed every check: entry
// names (no absolute paths, no "..", only the database and uploads/), total size
// (declared and actually written, against zip bombs), and the database itself (SQLite
// integrity check and the app's required tables). Then a "prerestore" safety backup is
// taken, and under the write lock the uploads are swapped first and the database last.
import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Database from 'better-sqlite3';
import yauzl from 'yauzl';
import yazl from 'yazl';
import type { Logger } from './logger.ts';
import type { WithLock } from './lock.ts';

export interface BackupSettings {
  /** File-name prefix, e.g. 'crane-backup'. */
  prefix: string;
  backupDir: string;
  dbPath: string;
  uploadsDir: string;
  includeUploads: boolean;
  keep: number;
  maxRestoreBytes: number;
  /** Tables a backup's database must contain to be restorable. */
  requiredTables: string[];
}

export interface BackupContext {
  settings: BackupSettings;
  withLock: WithLock;
  /** The live database handle (it changes after a restore). */
  getDb: () => Database.Database;
}

export class RestoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RestoreError';
  }
}

const UPLOADS_PREFIX = 'uploads/';

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
}

export function backupName(prefix: string, date: Date, label?: string): string {
  return `${prefix}-${stamp(date)}${label ? `-${label}` : ''}.zip`;
}

function nameRe(prefix: string): RegExp {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}-\\d{8}-\\d{6}(?:-([a-z]+))?\\.zip$`);
}

/** Only names this app wrote can be downloaded or restored by name (no paths). */
export function isBackupName(prefix: string, name: string): boolean {
  return nameRe(prefix).test(name);
}

async function listTree(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(
    (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  );
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort();
}

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: Date;
}

export async function listBackups(settings: BackupSettings): Promise<BackupInfo[]> {
  const re = nameRe(settings.prefix);
  const names = (await readdir(settings.backupDir).catch(() => [] as string[])).filter((n) =>
    re.test(n)
  );
  const infos = await Promise.all(
    names.map(async (name) => {
      const s = await stat(join(settings.backupDir, name));
      return { name, size: s.size, createdAt: s.mtime };
    })
  );
  return infos.sort((a, b) => b.name.localeCompare(a.name));
}

/** Keeps the newest `keep` backups of each kind (unlabelled, prerestore, ...). */
export async function pruneBackups(settings: BackupSettings): Promise<string[]> {
  const re = nameRe(settings.prefix);
  const groups = new Map<string, string[]>();
  for (const { name } of await listBackups(settings)) {
    const label = re.exec(name)?.[1] ?? '';
    groups.set(label, [...(groups.get(label) ?? []), name]);
  }
  const removed: string[] = [];
  for (const names of groups.values()) {
    for (const name of names.slice(settings.keep)) {
      await unlink(join(settings.backupDir, name));
      removed.push(name);
    }
  }
  return removed;
}

export async function createBackup(
  ctx: BackupContext,
  options: { label?: string; now?: Date } = {}
): Promise<string> {
  const { settings } = ctx;
  await mkdir(settings.backupDir, { recursive: true });
  const final = join(
    settings.backupDir,
    backupName(settings.prefix, options.now ?? new Date(), options.label)
  );
  const partial = `${final}.partial`;
  const snapshot = join(settings.backupDir, `.snapshot-${process.pid}-${Date.now()}.db`);
  try {
    await ctx.withLock(async () => {
      await ctx.getDb().backup(snapshot);
      const zip = new yazl.ZipFile();
      zip.addFile(snapshot, basename(settings.dbPath));
      if (settings.includeUploads) {
        for (const file of await listTree(settings.uploadsDir)) {
          zip.addFile(join(settings.uploadsDir, file), `${UPLOADS_PREFIX}${file}`);
        }
      }
      zip.end();
      await pipeline(zip.outputStream, createWriteStream(partial));
    });
    await rename(partial, final);
  } finally {
    await rm(snapshot, { force: true });
    await rm(partial, { force: true });
  }
  await pruneBackups(settings);
  return final;
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((done, fail) =>
    yauzl.open(path, { lazyEntries: true, validateEntrySizes: true }, (err, zip) =>
      err || !zip ? fail(err ?? new Error('could not open')) : done(zip)
    )
  );
}

function safeEntryName(name: string): boolean {
  return (
    !name.startsWith('/') &&
    !name.includes('\\') &&
    !/^[a-zA-Z]:/.test(name) &&
    !name.split('/').some((part) => part === '..')
  );
}

/** Walks every entry, calling `onFile` for files; rejects anything unsafe or too big. */
async function walkArchive(
  path: string,
  settings: BackupSettings,
  onFile?: (entry: yauzl.Entry, zip: yauzl.ZipFile) => Promise<void>
): Promise<{ hasDb: boolean; hasUploads: boolean }> {
  const dbName = basename(settings.dbPath);
  let zip: yauzl.ZipFile;
  try {
    zip = await openZip(path);
  } catch (err) {
    throw new RestoreError(`not a valid backup archive: ${(err as Error).message}`, { cause: err });
  }
  let total = 0;
  let hasDb = false;
  let hasUploads = false;
  try {
    await new Promise<void>((done, fail) => {
      zip.on('error', fail);
      zip.on('end', done);
      zip.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          const name = entry.fileName;
          if (!safeEntryName(name)) throw new RestoreError(`unsafe path in backup: ${name}`);
          const isDir = name.endsWith('/');
          if (name === dbName) hasDb = true;
          else if (name.startsWith(UPLOADS_PREFIX)) hasUploads = hasUploads || !isDir;
          else throw new RestoreError(`unexpected file in backup: ${name}`);
          total += entry.uncompressedSize;
          if (total > settings.maxRestoreBytes)
            throw new RestoreError('backup is too large to restore');
          if (!isDir && onFile) await onFile(entry, zip);
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  } catch (err) {
    if (err instanceof RestoreError) throw err;
    throw new RestoreError(`not a valid backup archive: ${(err as Error).message}`, { cause: err });
  } finally {
    zip.close();
  }
  if (!hasDb) throw new RestoreError(`backup has no ${dbName}`);
  return { hasDb, hasUploads };
}

function readStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((done, fail) =>
    zip.openReadStream(entry, (err, stream) =>
      err || !stream ? fail(err ?? new Error('unreadable')) : done(stream)
    )
  );
}

async function extract(
  path: string,
  settings: BackupSettings,
  dest: string
): Promise<{ hasUploads: boolean }> {
  let written = 0;
  return walkArchive(path, settings, async (entry, zip) => {
    const target = join(dest, entry.fileName);
    if (!target.startsWith(dest + sep))
      throw new RestoreError(`unsafe path in backup: ${entry.fileName}`);
    await mkdir(dirname(target), { recursive: true });
    const counter = new Transform({
      transform(chunk: Buffer, _enc, next) {
        written += chunk.length;
        if (written > settings.maxRestoreBytes)
          next(new RestoreError('backup is too large to restore'));
        else next(null, chunk);
      },
    });
    await pipeline(await readStream(zip, entry), counter, createWriteStream(target));
  });
}

function checkDatabase(path: string, requiredTables: string[]): void {
  let db: Database.Database | undefined;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const result = db.pragma('integrity_check', { simple: true });
    if (result !== 'ok') throw new Error(`integrity check: ${String(result)}`);
    const tables = new Set(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
          name: string;
        }>
      ).map((r) => r.name)
    );
    const missing = requiredTables.filter((t) => !tables.has(t));
    if (missing.length) throw new Error(`missing tables: ${missing.join(', ')}`);
  } catch (err) {
    throw new RestoreError(`the backup's database is not usable: ${(err as Error).message}`, {
      cause: err,
    });
  } finally {
    db?.close();
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false
  );
}

/** Rename, or copy and delete when the two are on different disks (uploads on a NAS). */
async function moveDir(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await cp(src, dest, { recursive: true });
    await rm(src, { recursive: true, force: true });
  }
}

export interface RestoreHooks {
  /** Close the live database handle before its file is replaced. */
  closeDb: () => void;
  /** Open it again afterwards (also called if the swap fails). */
  openDb: () => void;
  logger?: Logger;
}

export interface RestoreResult {
  safetyBackup: string;
  restoredUploads: boolean;
}

export async function restoreBackup(
  ctx: BackupContext,
  zipPath: string,
  hooks: RestoreHooks
): Promise<RestoreResult> {
  const { settings } = ctx;
  const dbName = basename(settings.dbPath);
  await walkArchive(zipPath, settings); // cheap first pass: names and declared sizes
  const staging = await mkdtemp(join(dirname(settings.dbPath), '.restore-'));
  try {
    const { hasUploads } = await extract(zipPath, settings, staging);
    checkDatabase(join(staging, dbName), settings.requiredTables);
    const safetyBackup = basename(await createBackup(ctx, { label: 'prerestore' }));

    await ctx.withLock(async () => {
      hooks.closeDb();
      const oldUploads = join(staging, '.previous-uploads');
      let uploadsSwapped = false;
      try {
        if (hasUploads) {
          if (await exists(settings.uploadsDir)) await moveDir(settings.uploadsDir, oldUploads);
          await moveDir(join(staging, 'uploads'), settings.uploadsDir);
          uploadsSwapped = true;
        }
        await rm(`${settings.dbPath}-wal`, { force: true });
        await rm(`${settings.dbPath}-shm`, { force: true });
        await rename(join(staging, dbName), settings.dbPath);
      } catch (err) {
        if (uploadsSwapped && (await exists(oldUploads))) {
          await rm(settings.uploadsDir, { recursive: true, force: true });
          await moveDir(oldUploads, settings.uploadsDir);
        }
        throw err;
      } finally {
        hooks.openDb();
      }
    });
    hooks.logger?.info(
      { from: basename(zipPath), safetyBackup, restoredUploads: hasUploads },
      'Restored a backup'
    );
    return { safetyBackup, restoredUploads: hasUploads };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export interface SchedulerStatus {
  enabled: boolean;
  intervalHours: number;
  lastSuccessAt?: string;
  lastError?: string;
  nextRunAt?: string;
}

/**
 * Runs `run` every intervalHours; the first run comes after five minutes (or the
 * interval, if shorter), so a restart loop doesn't back up on every start.
 */
export function startBackupScheduler(options: {
  enabled: boolean;
  intervalHours: number;
  run: () => Promise<unknown>;
  logger: Logger;
}): { stop: () => void; status: () => SchedulerStatus } {
  const state: SchedulerStatus = { enabled: options.enabled, intervalHours: options.intervalHours };
  const intervalMs = options.intervalHours * 3_600_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (delay: number) => {
    state.nextRunAt = new Date(Date.now() + delay).toISOString();
    timer = setTimeout(() => void tick(), delay);
    timer.unref();
  };
  const tick = async () => {
    try {
      await options.run();
      state.lastSuccessAt = new Date().toISOString();
      delete state.lastError;
    } catch (err) {
      state.lastError = (err as Error).message;
      options.logger.error({ err }, 'Scheduled backup failed');
    }
    schedule(intervalMs);
  };
  if (options.enabled) schedule(Math.min(300_000, intervalMs));
  return {
    stop: () => {
      if (timer) clearTimeout(timer);
      delete state.nextRunAt;
    },
    status: () => ({ ...state }),
  };
}
