// updater.ts — v2.0.0 (03/10/2026) — acaba com o loop de download do auto-update.
//
// INCIDENTE (J.Kastros, 03/10/2026): o agente baixou o .exe de 58 MB **265 vezes no mesmo dia**
// (a cada 30-45 s, em vez de 1x por hora) e seguiu na 0.9.8 com a 0.9.12 publicada. ~15 GB de
// banda e a correção dos títulos nunca chegou na loja.
//
// CAUSA: corrida entre o nssm e o .bat. O v1 fazia: baixa -> agenda .bat -> process.exit(0).
// O nssm tem AppRestartDelay=5000, então subia o agente DE NOVO em 5 s; o .bat esperava 6 s
// (`ping -n 6`) e só então tentava `move` — com o .exe já em uso outra vez. Tentava 10x e
// desistia. O agente recém-subido esperava 1 min (primeiro check), achava a versão nova de novo,
// rebaixava os 58 MB e repetia para sempre.
//
// CORREÇÃO (3 partes, independentes):
// 1. TROCA SEM CORRIDA: no Windows um .exe EM USO pode ser RENOMEADO (só não pode ser apagado).
//    Então o .bat renomeia o atual para `.old` e põe o novo no nome original — funciona com o
//    serviço rodando, sem parar nada e sem depender de janela de tempo. O processo em memória
//    segue do arquivo antigo; o próximo start do nssm já pega o binário novo.
// 2. NÃO REBAIXAR: se o staging `.new` já existe e o sha256 bate com o manifesto, reaproveita em
//    vez de buscar 58 MB de novo.
// 3. FREIO: a versão tentada fica gravada em `update-tentativa.json`. Se a troca não surtiu
//    efeito, o agente espera 6 h antes de tentar a MESMA versão outra vez (em vez de 1 min), e
//    para de tentar de vez após 3 falhas — registrando no log que precisa de uma pessoa.
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
const REPETIR_APOS_FALHA_MS = 6 * 60 * 60 * 1000; // 6 h antes de insistir na MESMA versao
const MAX_TENTATIVAS = 3; // depois disso, para e pede ajuda no log

// Memoria das tentativas, ao lado do .exe. Sobrevive ao restart do nssm — e justamente o
// restart que apagava a memoria do v1 e realimentava o loop.
interface Tentativa {
  versao: string;
  tentativas: number;
  ultimaEm: string; // ISO
}

function caminhoTentativa(exeDir: string): string {
  return path.join(exeDir, 'update-tentativa.json');
}

function lerTentativa(exeDir: string): Tentativa | null {
  try {
    const txt = fs.readFileSync(caminhoTentativa(exeDir), 'utf-8');
    const t = JSON.parse(txt) as Tentativa;
    return typeof t?.versao === 'string' && typeof t?.tentativas === 'number' ? t : null;
  } catch {
    return null; // nunca tentou, ou arquivo corrompido: trata como primeira vez
  }
}

function gravarTentativa(exeDir: string, t: Tentativa): void {
  try {
    fs.writeFileSync(caminhoTentativa(exeDir), JSON.stringify(t, null, 2), 'utf-8');
  } catch (err) {
    // Não poder gravar o freio não justifica deixar de atualizar; só avisa.
    logger.warn({ err }, 'nao foi possivel gravar update-tentativa.json');
  }
}

function limparTentativa(exeDir: string): void {
  try {
    fs.unlinkSync(caminhoTentativa(exeDir));
  } catch {
    /* nao existia: nada a fazer */
  }
}

// v2.0.0 — a decisão do freio é PURA e exportada só para o teste poder exercitá-la sem Windows,
// sem rede e sem relógio real. É o coração da correção do loop: se isto errar, o agente volta a
// baixar 58 MB por minuto.
export type DecisaoUpdate =
  | { acao: 'atualizar'; tentativa: number }
  | { acao: 'pular'; motivo: 'ja-atualizado' }
  | { acao: 'pular'; motivo: 'aguardando-janela'; faltamMs: number }
  | { acao: 'pular'; motivo: 'desistiu'; tentativas: number };

export function decidirUpdate(
  versaoAtual: string,
  versaoNova: string,
  anterior: Tentativa | null,
  agora: number,
): DecisaoUpdate {
  if (compareVersions(versaoNova, versaoAtual) <= 0) return { acao: 'pular', motivo: 'ja-atualizado' };

  // Tentativa de OUTRA versão não freia a nova: versão nova zera a contagem.
  if (!anterior || anterior.versao !== versaoNova) return { acao: 'atualizar', tentativa: 1 };

  if (anterior.tentativas >= MAX_TENTATIVAS) {
    return { acao: 'pular', motivo: 'desistiu', tentativas: anterior.tentativas };
  }
  const desdeUltima = agora - new Date(anterior.ultimaEm).getTime();
  // Data corrompida no arquivo não pode travar o update para sempre: trata como janela vencida.
  if (Number.isFinite(desdeUltima) && desdeUltima < REPETIR_APOS_FALHA_MS) {
    return { acao: 'pular', motivo: 'aguardando-janela', faltamMs: REPETIR_APOS_FALHA_MS - desdeUltima };
  }
  return { acao: 'atualizar', tentativa: anterior.tentativas + 1 };
}

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

function sha256Do(arquivo: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex');
  } catch {
    return null;
  }
}

// v2.0.0 — reaproveita o staging já baixado. Era isso que fazia o loop custar 58 MB por volta:
// o binário correto já estava no disco e era baixado outra vez.
async function baixarSeNecessario(url: string, shaEsperado: string, destino: string): Promise<void> {
  const shaLocal = sha256Do(destino);
  if (shaLocal && shaLocal.toLowerCase() === shaEsperado.toLowerCase()) {
    logger.info({ destino }, 'binario novo ja estava baixado e com sha256 correto — reaproveitando');
    return;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download falhou: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const obtido = crypto.createHash('sha256').update(buf).digest('hex');
  if (obtido.toLowerCase() !== shaEsperado.toLowerCase()) {
    throw new Error(`SHA256 nao bate: esperado ${shaEsperado}, obtido ${obtido}`);
  }
  fs.writeFileSync(destino, buf);
}

function spawnDetachedUpdater(stagingPath: string, currentExePath: string): void {
  // v2.0.0 — RENAME, não espera. No Windows o nome de um .exe em uso pode ser trocado; o que
  // o sistema recusa é APAGAR. Então: renomeia o atual para `.old`, põe o novo no nome real.
  // Não há corrida com o restart do nssm (5 s) porque não dependemos mais de o processo ter
  // saído: funciona com ele rodando.
  //
  // O `.old` fica para trás de propósito quando ainda está em uso — a próxima execução do .bat
  // apaga. Tentar apagar à força aqui falharia e abortaria a troca.
  //
  // NAO usar `timeout /t`: exige console de entrada e o processo é criado com stdio 'ignore' —
  // falha na hora com "Input redirection is not supported". `ping -n` espera sem console.
  // (Lição de 27/08.)
  const exeDir = path.dirname(currentExePath);
  const batchPath = path.join(exeDir, 'updater.bat');
  const logPath = path.join(exeDir, 'updater.log');
  const oldPath = `${currentExePath}.old`;
  const batchContent = `@echo off
echo [%date% %time%] inicio da troca (v2: rename) >>"${logPath}"

rem sobra de uma troca anterior: agora o .exe antigo nao esta mais em uso, da pra limpar
if exist "${oldPath}" del /F /Q "${oldPath}" >>"${logPath}" 2>&1

rem pequena folga: o agente pediu a troca e esta saindo
ping -n 3 127.0.0.1 >nul

set /a tentativa=0
:retry
set /a tentativa+=1

rem 1) tira o .exe atual do caminho. RENOMEAR arquivo em uso e permitido no Windows.
move /Y "${currentExePath}" "${oldPath}" >>"${logPath}" 2>&1
if exist "${currentExePath}" goto aindaOcupado

rem 2) o nome real esta livre: poe o binario novo nele
move /Y "${stagingPath}" "${currentExePath}" >>"${logPath}" 2>&1
if not exist "${currentExePath}" goto desfazer
goto ok

:aindaOcupado
if %tentativa% GEQ 10 goto falhou
ping -n 4 127.0.0.1 >nul
goto retry

:desfazer
rem o novo nao entrou: devolve o antigo para o lugar, senao o servico fica sem binario
move /Y "${oldPath}" "${currentExePath}" >>"${logPath}" 2>&1
echo [%date% %time%] FALHOU ao mover o binario novo - antigo restaurado >>"${logPath}"
exit /b 1

:ok
echo [%date% %time%] troca concluida na tentativa %tentativa% >>"${logPath}"
del "%~f0"
exit /b 0

:falhou
echo [%date% %time%] FALHOU apos %tentativa% tentativas - nao consegui renomear o exe >>"${logPath}"
exit /b 1
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

  const currentExePath = process.execPath;
  const exeDir = path.dirname(currentExePath);

  // v2.0.0 — FREIO. Sem isto o restart do nssm zerava a memória e o agente tentava de novo em
  // 1 min, para sempre. Com isto, uma troca que não surte efeito é tratada como problema a ser
  // olhado por uma pessoa, não como motivo para baixar 58 MB em looping.
  const anterior = lerTentativa(exeDir);
  const decisao = decidirUpdate(AGENT_VERSION, manifest.version, anterior, Date.now());

  if (decisao.acao === 'pular') {
    switch (decisao.motivo) {
      case 'ja-atualizado':
        // Se havia tentativa pendente, ela DEU CERTO — limpa o freio.
        if (anterior) {
          logger.info({ versao: AGENT_VERSION }, 'update concluido com sucesso — limpando marca de tentativa');
          limparTentativa(exeDir);
        }
        return;
      case 'desistiu':
        logger.error(
          { versao: manifest.version, tentativas: decisao.tentativas, log: path.join(exeDir, 'updater.log') },
          'auto-update desistiu depois de 3 tentativas — veja updater.log; precisa de intervencao manual',
        );
        return;
      case 'aguardando-janela':
        logger.warn(
          { versao: manifest.version, tentativas: anterior?.tentativas, faltamMin: Math.round(decisao.faltamMs / 60000) },
          'tentativa recente de update nao surtiu efeito — aguardando antes de tentar de novo',
        );
        return;
    }
  }

  logger.info(
    { atual: AGENT_VERSION, novo: manifest.version, tentativa: decisao.tentativa },
    'nova versao detectada — iniciando auto-update',
  );

  try {
    const stagingPath = `${currentExePath}.new`;
    await baixarSeNecessario(manifest.url, manifest.sha256, stagingPath);

    // Grava o freio ANTES de sair: depois do process.exit não há mais chance de registrar.
    gravarTentativa(exeDir, {
      versao: manifest.version,
      tentativas: decisao.tentativa,
      ultimaEm: new Date().toISOString(),
    });

    logger.info({ stagingPath }, 'binario novo baixado e verificado — agendando troca');
    spawnDetachedUpdater(stagingPath, currentExePath);

    // O serviço Windows (nssm) detecta saida do agente e reinicia em 5s. Com a troca por rename
    // isso deixou de ser uma corrida: se o .bat ainda não trocou, o agente sobe na versão velha
    // e o freio acima evita o loop; na próxima janela a troca acontece.
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
