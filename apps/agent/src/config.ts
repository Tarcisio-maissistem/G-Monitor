import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';

// Configuracao do agente persistida em %PROGRAMDATA%\GMonitor\agent.json
// Em desenvolvimento (não-Windows), usa diretorio local.

const configSchema = z.object({
  saasUrl: z.string().url(),
  wsUrl: z.string().url(),
  token: z.string().min(20),
  firebird: z.object({
    host: z.string().default('127.0.0.1'),
    port: z.number().int().default(3050),
    database: z.string(),
    user: z.string().default('SYSDBA'),
    password: z.string(),
  }),
  syncIntervalMs: z.number().int().default(30_000),
  updateChannel: z.enum(['stable', 'beta', 'canary']).default('stable'),
});

export type AgentConfig = z.infer<typeof configSchema>;

function getConfigPath(): string {
  if (process.platform === 'win32') {
    const base = process.env.PROGRAMDATA ?? 'C:\\ProgramData';
    return path.join(base, 'GMonitor', 'agent.json');
  }
  return path.join(os.homedir(), '.gmonitor', 'agent.json');
}

export function loadConfig(): AgentConfig {
  const file = getConfigPath();
  if (!fs.existsSync(file)) {
    throw new Error(`Arquivo de configuracao nao encontrado: ${file}`);
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  return configSchema.parse(raw);
}

export function saveConfig(cfg: AgentConfig): void {
  const file = getConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf-8');
}

export function getDataDir(): string {
  const cfgPath = getConfigPath();
  return path.dirname(cfgPath);
}
