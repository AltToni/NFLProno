import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';
import { runMigrations } from './migrate';

export const DATABASE_PATH = resolve(process.env.DATABASE_PATH ?? './data/nfl.db');

mkdirSync(dirname(DATABASE_PATH), { recursive: true });

export const sqlite = new Database(DATABASE_PATH);

// WAL : lectures concurrentes pendant les ecritures du poll de scores.
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

export const migrationsApplied = runMigrations(sqlite);

export const db = drizzle(sqlite, { schema });
export { schema };
