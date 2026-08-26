// Gera apps/web/public/downloads/latest.json (e dist/, se existir) a partir do exe recem
// empacotado — o updater do agente le esse manifesto em ${saasUrl}/downloads/latest.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const exe = path.join(root, 'apps/agent/release/gmonitor-agent.exe');
const versionTs = fs.readFileSync(path.join(root, 'apps/agent/src/version.ts'), 'utf8');
const version = /AGENT_VERSION = '([^']+)'/.exec(versionTs)?.[1];
if (!version) throw new Error('AGENT_VERSION nao encontrada em version.ts');
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
const base = process.env.GMONITOR_PUBLIC_URL ?? 'https://gmonitor.maissistem.com.br';
const manifest = { version, sha256, url: `${base}/downloads/gmonitor-agent.exe`, releasedAt: new Date().toISOString() };
for (const dir of ['apps/web/public/downloads', 'apps/web/dist/downloads']) {
  const d = path.join(root, dir);
  if (!fs.existsSync(d)) continue;
  fs.copyFileSync(exe, path.join(d, 'gmonitor-agent.exe'));
  fs.copyFileSync(path.join(root, 'apps/agent/installer/install.ps1'), path.join(d, 'install.ps1'));
  fs.writeFileSync(path.join(d, 'latest.json'), JSON.stringify(manifest, null, 2));
  console.log('latest.json ->', dir, version);
}
