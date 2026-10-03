import { describe, it, expect } from 'vitest';
import { resolveReport, resolveReportComIds } from './index.js';

// change reconciliacao-titulos-abertos (D2): o catalogo e a fronteira de seguranca — o marcador
// {{IDS}} só pode virar placeholders `?`, nunca receber valor concatenado.
describe('resolveReportComIds', () => {
  const entradas = [
    'reconcile-payables-pagar',
    'reconcile-payables-contas-pagar',
    'reconcile-receivables-receber',
    'reconcile-receivables-contas-receber',
  ] as const;

  it('as quatro variantes existem no catalogo (inclusive CONTAS_PAGAR, que nao tem `recent`)', () => {
    for (const id of entradas) expect(resolveReport(id), id).not.toBeNull();
  });

  it('expande {{IDS}} em exatamente N placeholders', () => {
    for (const id of entradas) {
      const sql = resolveReportComIds(id, 3)!.sql;
      expect(sql).not.toContain('{{IDS}}');
      expect(sql).toContain('IN (?, ?, ?)');
      expect(sql.match(/\?/g)).toHaveLength(3);
    }
  });

  it('1 id gera 1 placeholder e 200 ids geram 200', () => {
    expect(resolveReportComIds('reconcile-payables-pagar', 1)!.sql).toContain('IN (?)');
    expect(resolveReportComIds('reconcile-payables-pagar', 200)!.sql.match(/\?/g)).toHaveLength(200);
  });

  it('nao devolve consulta para quantidade invalida (evita `IN ()`)', () => {
    expect(resolveReportComIds('reconcile-payables-pagar', 0)).toBeNull();
    expect(resolveReportComIds('reconcile-payables-pagar', -1)).toBeNull();
  });

  it('nao inventa consulta fora do catalogo', () => {
    expect(resolveReportComIds('nao-existe', 5)).toBeNull();
  });

  it('a consulta original (template) nao e mutada entre chamadas', () => {
    const antes = resolveReport('reconcile-payables-pagar')!.sql;
    resolveReportComIds('reconcile-payables-pagar', 7);
    expect(resolveReport('reconcile-payables-pagar')!.sql).toBe(antes);
    expect(antes).toContain('{{IDS}}');
  });

  it('o schema de parametro limita o lote a 200 ids', () => {
    const schema = resolveReport('reconcile-payables-pagar')!.paramSchema;
    expect(schema.safeParse({ ids: Array.from({ length: 200 }, (_, i) => i) }).success).toBe(true);
    expect(schema.safeParse({ ids: Array.from({ length: 201 }, (_, i) => i) }).success).toBe(false);
    expect(schema.safeParse({ ids: [] }).success).toBe(false);
  });
});
