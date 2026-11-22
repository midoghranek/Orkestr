import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { dataDir } from "../util/paths";
import { MIGRATIONS } from "./migrations";

/**
 * SQLite via Node's built-in `node:sqlite` (no native addon to compile on Windows/Node 26).
 * WAL mode lets the web server and the worker process share one database file safely.
 */
let db: DatabaseSync | undefined;
let dbPath: string | undefined;

export function getDb(): DatabaseSync {
  const target = process.env.ORKESTR_DB ?? path.join(dataDir(), "orkestr.db");
  if (db && dbPath === target) return db;
  db?.close();
  db = new DatabaseSync(target);
  dbPath = target;
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA synchronous = NORMAL;");
  migrate(db);
  return db;
}

/** For tests: close and forget the current handle. */
export function closeDb(): void {
  db?.close();
  db = undefined;
  dbPath = undefined;
}

function migrate(d: DatabaseSync): void {
  d.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const applied = new Set(
    (d.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    tx(d, () => {
      d.exec(m.sql);
      d.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(m.version, Date.now());
    });
  }
}

/** Run fn inside an IMMEDIATE transaction (takes the write lock up front: no upgrade deadlocks between processes). */
export function tx<T>(d: DatabaseSync, fn: () => T): T {
  d.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

export function transaction<T>(fn: () => T): T {
  return tx(getDb(), fn);
}

export function json<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === "") return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
