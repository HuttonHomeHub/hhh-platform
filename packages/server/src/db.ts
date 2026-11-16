// Opens the app's SQLite database the same way everywhere: WAL (readers don't block
// the writer), foreign keys enforced, and a busy timeout instead of instant failure.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type { Database } from 'better-sqlite3';

export function openDatabase(
  path: string,
  options: { readonly?: boolean } = {}
): Database.Database {
  if (!options.readonly) mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, options.readonly ? { readonly: true, fileMustExist: true } : {});
  if (!options.readonly) db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

/** For /ready: throws if the database can't answer. */
export function pingDatabase(db: Database.Database): void {
  db.prepare('SELECT 1').get();
}

/** The app's own tables (SQLite's internal ones excluded). */
export function userTables(db: Database.Database): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}
