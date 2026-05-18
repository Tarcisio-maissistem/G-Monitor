import Database from 'better-sqlite3';
import path from 'node:path';
import { getDataDir } from '../config.js';

// Checkpoints locais por tabela em SQLite.
// Caminho: %PROGRAMDATA%\GMonitor\sync.db

const dbPath = path.join(getDataDir(), 'sync.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS sync_checkpoints (
    table_name TEXT PRIMARY KEY,
    checkpoint TEXT NOT NULL,
    last_synced_at TEXT NOT NULL
  )
`);

export function getCheckpoint(table: string): string | null {
  const row = db.prepare('SELECT checkpoint FROM sync_checkpoints WHERE table_name = ?').get(table) as
    | { checkpoint: string }
    | undefined;
  return row?.checkpoint ?? null;
}

export function setCheckpoint(table: string, checkpoint: string): void {
  db.prepare(
    'INSERT INTO sync_checkpoints(table_name, checkpoint, last_synced_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(table_name) DO UPDATE SET checkpoint = excluded.checkpoint, last_synced_at = excluded.last_synced_at',
  ).run(table, checkpoint, new Date().toISOString());
}
