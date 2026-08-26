import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { AGENT_VERSION } from './version.js';
import { logger } from './logger.js';
import type { AgentConfig } from './config.js';

// Manifesto em `${saasUrl}/downloads/latest.json` — mesmo lugar do instalador (nginx serve
// apps/web/dist/downloads). Gerado por apps/agent/scripts/write-latest.mjs a cada `pnpm package`.
// Contem versao + sha256 + URL do binario novo. (Antes apontava pra host:8088 que nunca existiu.)
interface UpdateManifest {
  version: string;
  sha256: string;
  url: string;
  releasedAt?: string;
  notes?: string;
}

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hora

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

async function fetchManifest(cfg: AgentConfig): Promise<UpdateManifest | null> {
  try {
    const baseUrl = cfg.saasUrl.replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/downloads/latest.json`, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) return null;
    return (await res.json()) as UpdateManifest;
  } catch (err) {
    logger.warn({ err }, 'falha ao buscar manifesto de update');
    return null;
  }
}

async function downloadAndVerify(url: string, expectedSha256: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download falhou: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = crypto.createHash('sha256').update(buf).digest('hex');
  if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(`SHA256 nao bate: esperado ${expectedSha256}, obtido ${actual}`);
  }
  fs.writeFileSync(destPath, buf);
}

function spawnDetachedUpdater(stagingPath: string, currentExePath: string): void {
  // Cria um .bat que aguarda o processo atual sair, troca o exe e deixa o
  // nssm reiniciar o servico (config AppRestartDelay=5s ja foi gravada).
  const batchPath = path.join(path.dirname(currentExePath), 'updater.bat');
  const batchContent = `@echo off
timeout /t 4 /nobreak >nul
move /Y "${stagingPath}" "${currentExePath}"
del "%~f0"
`;
  fs.writeFileSync(batchPath, batchContent, 'utf-8');

  const child = spawn('cmd.exe', ['/c', batchPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

async function checkAndApply(cfg: AgentConfig): Promise<void> {
  const manifest = await fetchManifest(cfg);
  if (!manifest) return;

  if (compareVersions(manifest.version, AGENT_VERSION) <= 0) {
    return; // ja estamos na ultima ou mais recente
  }

  logger.info(
    { atual: AGENT_VERSION, novo: manifest.version },
    'nova versao detectada — iniciando auto-update',
  );

  try {
    // process.execPath é o caminho do .exe atual.
    const currentExePath = process.execPath;
    const stagingPath = `${currentExePath}.new`;
    await downloadAndVerify(manifest.url, manifest.sha256, stagingPath);

    logger.info({ stagingPath }, 'binario novo baixado e verificado — agendando troca');
    spawnDetachedUpdater(stagingPath, currentExePath);

    // O serviço Windows (nssm) detecta saida do agente e reinicia em 5s,
    // tempo suficiente pro .bat trocar o .exe.
    logger.info('saindo para o nssm reiniciar com nova versao');
    setTimeout(() => process.exit(0), 1500);
  } catch (err) {
    logger.error({ err }, 'falha no auto-update — mantendo versao atual');
  }
}

export function startUpdaterLoop(cfg: AgentConfig): NodeJS.Timeout {
  // primeiro check 1 min apos start (o dono quer atualizar assim que houver versao nova)
  setTimeout(() => void checkAndApply(cfg), 60 * 1000);
  return setInterval(() => void checkAndApply(cfg), CHECK_INTERVAL_MS);
}
