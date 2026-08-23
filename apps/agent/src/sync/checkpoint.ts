import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from '../config.js';

// Checkpoints locais por tabela — arquivo JSON simples, nao SQLite.
// E so um mapa table_name -> {checkpoint, lastSyncedAt}, nao precisa de banco de verdade
// e evita depender de compilacao nativa (better-sqlite3 exige Visual Studio Build Tools
// se nao houver prebuild pra versao/arch do Node do cliente — achado 22/08 no piloto).
// Caminho: %PROGRAMDATA%\GMonitor\sync.json

interface CheckpointRow {
  checkpoint: string;
  lastSyncedAt: string;
}

const filePath = path.join(getDataDir(), 'sync.json');

function readAll(): Record<string, CheckpointRow> {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, CheckpointRow>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Escreve em arquivo temporario e renomeia — evita corromper o arquivo se o processo
  // morrer no meio da escrita.
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function getCheckpoint(table: string): string | null {
  return readAll()[table]?.checkpoint ?? null;
}

export function setCheckpoint(table: string, checkpoint: string): void {
  const data = readAll();
  data[table] = { checkpoint, lastSyncedAt: new Date().toISOString() };
  writeAll(data);
}
