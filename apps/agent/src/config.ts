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
  // BOM: o PowerShell 5.1 grava `Set-Content -Encoding utf8` com BOM (EF BB BF) e o JSON.parse
  // estoura com "Unexpected token '\ufeff'". O agente morria no boot ANTES de escrever qualquer
  // log — o servico so aparecia como "Paused". Foi o que impediu TODA instalacao nova de
  // funcionar ate 27/08 (J.Kastros). Config de cliente nao pode derrubar o agente por causa de
  // 3 bytes invisiveis: tira o BOM e segue.
  const texto = fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
  const raw = JSON.parse(texto);
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
