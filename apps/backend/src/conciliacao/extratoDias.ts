// Funcoes puras de calendario do cache do extrato (sem banco: testaveis isoladas).
const DIA_MS = 86_400_000;

/** 'YYYY-MM-DD' de hoje no horario de Brasilia (UTC-3, sem horario de verao desde 2019). */
export function hojeBrasilia(agora: Date = new Date()): string {
  return new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

/** Todos os dias de from a to (inclusive), em 'YYYY-MM-DD'. */
export function diasDoPeriodo(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DIA_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Quais dias precisam ir ao portal: os que nao estao no cache ou que foram baixados ainda abertos. */
export function diasParaBuscar(periodo: string[], fechados: Set<string>): string[] {
  return periodo.filter((d) => !fechados.has(d));
}

/** [24/09] Dia ainda aberto (hoje) baixado ha menos disso e reaproveitado do arquivo: o portal
 *  GetCard leva segundos por consulta e o painel pede extrato/banco-dia a cada tela aberta. */
export const JANELA_DIA_ABERTO_MS = 5 * 60_000;

/** O dia do arquivo pode ser usado sem ir ao portal? Fechado sempre; aberto so se baixado agora ha pouco. */
export function diaUsavel(dia: { fechado: boolean; baixadoEm: Date }, agora: Date = new Date()): boolean {
  return dia.fechado || agora.getTime() - dia.baixadoEm.getTime() < JANELA_DIA_ABERTO_MS;
}
