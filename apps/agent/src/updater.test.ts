// updater.test.ts — v1.0.0 (03/10/2026) — change updater-loop-download.
//
// PROVA do freio que mata o loop de download. O caso real: J.Kastros baixou o .exe de 58 MB
// 265 vezes num dia (a cada 30-45 s) e continuou na 0.9.8 com a 0.9.12 publicada.
//
// A decisão é pura de propósito: dá para exercitar o loop inteiro sem Windows, sem rede e sem
// esperar 6 horas.
import { describe, it, expect } from 'vitest';
import { decidirUpdate } from './updater.js';

const H = 60 * 60 * 1000;
const AGORA = new Date('2026-10-03T18:00:00Z').getTime();
const tent = (versao: string, tentativas: number, horasAtras: number) => ({
  versao,
  tentativas,
  ultimaEm: new Date(AGORA - horasAtras * H).toISOString(),
});

describe('decidirUpdate — o freio que impede o loop de 58 MB', () => {
  it('sem tentativa anterior e com versao nova: atualiza (tentativa 1)', () => {
    expect(decidirUpdate('0.9.8', '0.9.12', null, AGORA)).toEqual({ acao: 'atualizar', tentativa: 1 });
  });

  it('versao do manifesto igual a atual: pula como ja-atualizado', () => {
    expect(decidirUpdate('0.9.12', '0.9.12', null, AGORA)).toEqual({ acao: 'pular', motivo: 'ja-atualizado' });
  });

  it('manifesto ATRAS da versao instalada: nao faz downgrade', () => {
    expect(decidirUpdate('0.9.12', '0.9.8', null, AGORA)).toEqual({ acao: 'pular', motivo: 'ja-atualizado' });
  });

  // ESTE é o teste do incidente: o v1 respondia "atualizar" aqui, a cada minuto, para sempre.
  it('tentou a MESMA versao ha 1 minuto: ESPERA (era aqui que o loop nascia)', () => {
    const d = decidirUpdate('0.9.8', '0.9.12', tent('0.9.12', 1, 1 / 60), AGORA);
    expect(d.acao).toBe('pular');
    expect(d).toMatchObject({ motivo: 'aguardando-janela' });
  });

  it('tentou a mesma versao ha 5h59: ainda espera', () => {
    expect(decidirUpdate('0.9.8', '0.9.12', tent('0.9.12', 1, 5.98), AGORA)).toMatchObject({
      acao: 'pular',
      motivo: 'aguardando-janela',
    });
  });

  it('passadas as 6h: tenta de novo, contando a tentativa 2', () => {
    expect(decidirUpdate('0.9.8', '0.9.12', tent('0.9.12', 1, 6.1), AGORA)).toEqual({
      acao: 'atualizar',
      tentativa: 2,
    });
  });

  it('depois de 3 tentativas: desiste e pede intervencao (nao fica tentando eternamente)', () => {
    expect(decidirUpdate('0.9.8', '0.9.12', tent('0.9.12', 3, 99), AGORA)).toEqual({
      acao: 'pular',
      motivo: 'desistiu',
      tentativas: 3,
    });
  });

  it('versao NOVA zera a contagem: 3 falhas na 0.9.12 nao bloqueiam a 0.9.13', () => {
    expect(decidirUpdate('0.9.8', '0.9.13', tent('0.9.12', 3, 0.01), AGORA)).toEqual({
      acao: 'atualizar',
      tentativa: 1,
    });
  });

  it('data corrompida no arquivo de tentativa nao trava o update para sempre', () => {
    const d = decidirUpdate('0.9.8', '0.9.12', { versao: '0.9.12', tentativas: 1, ultimaEm: 'nao-e-data' }, AGORA);
    expect(d).toEqual({ acao: 'atualizar', tentativa: 2 });
  });

  it('compara numero, nao texto: 0.9.10 e mais novo que 0.9.9', () => {
    expect(decidirUpdate('0.9.9', '0.9.10', null, AGORA)).toEqual({ acao: 'atualizar', tentativa: 1 });
    expect(decidirUpdate('0.9.10', '0.9.9', null, AGORA)).toEqual({ acao: 'pular', motivo: 'ja-atualizado' });
  });

  it('versao com menos partes: 1.0 conta como 1.0.0 e supera 0.9.12', () => {
    expect(decidirUpdate('0.9.12', '1.0', null, AGORA)).toEqual({ acao: 'atualizar', tentativa: 1 });
  });

  // Simula o dia inteiro do incidente: o v1 teria baixado a cada minuto.
  it('24h de checagens de 1 min: no maximo 3 downloads, nao 1.440', () => {
    let anterior: { versao: string; tentativas: number; ultimaEm: string } | null = null;
    let downloads = 0;
    for (let min = 0; min < 24 * 60; min++) {
      const agora = AGORA + min * 60 * 1000;
      const d = decidirUpdate('0.9.8', '0.9.12', anterior, agora);
      if (d.acao === 'atualizar') {
        downloads++;
        anterior = { versao: '0.9.12', tentativas: d.tentativa, ultimaEm: new Date(agora).toISOString() };
      }
    }
    expect(downloads).toBe(3); // 1 imediata + 1 em 6h + 1 em 12h, depois desiste
  });
});
