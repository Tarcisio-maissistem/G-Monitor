import { createFirebirdPool } from './firebird/client.js';
import type { AgentConfig } from './config.js';

// Autodeteccao do CNPJ da PROPRIA loja no Firebird/GDOOR, pra instalar sem digitar nada
// (pedido do dono 25/08, refeito 27/08 depois de medir contra dois bancos reais).
//
// A 1a versao varria RDB$RELATION_FIELDS atras de QUALQUER coluna CNPJ/CGC e desempatava pela
// tabela com MENOS linhas. Medido em producao: **80-90 segundos** (fazia COUNT(*) em 53
// tabelas, incluindo as de milhoes de linhas) e **escolhia errado** — no banco do dono pegava
// 27644092000107 (de OPERADORA_CARTAO/EMITENTE indistintamente) em vez do CNPJ da loja.
//
// Agora: caminho rapido por tabela CONHECIDA, na ordem de confianca. `EMITENTE` e o emitente
// fiscal do GDOOR — por definicao e a propria loja, que e exatamente o que queremos. So se
// nenhuma conhecida responder e que cai na varredura antiga (lenta, mas melhor que nada).
export interface CnpjCandidate {
  table: string;
  column: string;
  value: string;
  rowCount: number;
}

// Ordem de confianca: emitente fiscal primeiro; o resto e rede de seguranca pra outros
// layouts de GDOOR. OPERADORA_CARTAO fica por ultimo: la o CNPJ costuma ser o do
// estabelecimento credenciado, que NEM SEMPRE e o da loja.
const TABELAS_CONHECIDAS: Array<{ table: string; column: string }> = [
  { table: 'EMITENTE', column: 'CNPJ' },
  { table: 'EMPRESA', column: 'CNPJ' },
  { table: 'EMPRESAS', column: 'CNPJ' },
  { table: 'CONFIGURACOES', column: 'CNPJ' },
  { table: 'PARAMETROS', column: 'CNPJ' },
  { table: 'OPERADORA_CARTAO', column: 'CNPJ' },
];

const soDigitos = (v: unknown): string => (v != null ? String(v).replace(/[^0-9]/g, '') : '');

export async function detectCnpj(fb: AgentConfig['firebird']): Promise<CnpjCandidate | null> {
  const pool = createFirebirdPool({ firebird: fb } as AgentConfig);
  try {
    // 1) caminho rapido: tabelas conhecidas, em ordem. Responde em milissegundos.
    for (const { table, column } of TABELAS_CONHECIDAS) {
      try {
        const rows = await pool.query<Record<string, unknown>>(
          `SELECT FIRST 1 ${column} AS V FROM ${table} WHERE ${column} IS NOT NULL`,
        );
        const value = soDigitos(rows[0]?.['v'] ?? rows[0]?.['V']);
        if (value.length === 14) return { table, column, value, rowCount: 1 };
      } catch {
        // tabela nao existe neste layout de GDOOR — proxima
      }
    }

    // 2) fallback: varredura. So roda se nenhuma tabela conhecida serviu.
    const columns = await pool.query<{ table_name: string; field_name: string }>(`
      SELECT TRIM(r.RDB$RELATION_NAME) AS TABLE_NAME, TRIM(f.RDB$FIELD_NAME) AS FIELD_NAME
      FROM RDB$RELATION_FIELDS f
      JOIN RDB$RELATIONS r ON r.RDB$RELATION_NAME = f.RDB$RELATION_NAME
      WHERE (UPPER(f.RDB$FIELD_NAME) LIKE '%CNPJ%' OR UPPER(f.RDB$FIELD_NAME) LIKE '%CGC%')
        AND (r.RDB$SYSTEM_FLAG IS NULL OR r.RDB$SYSTEM_FLAG = 0)
    `);

    const candidates: CnpjCandidate[] = [];
    for (const col of columns) {
      const table = col.table_name;
      const field = col.field_name;
      try {
        // Le a 1a linha ANTES de contar: se nao houver CNPJ valido nem precisa do COUNT(*),
        // que e o que fazia a varredura levar 90s.
        const rows = await pool.query<Record<string, unknown>>(
          `SELECT FIRST 1 ${field} AS V FROM ${table} WHERE ${field} IS NOT NULL`,
        );
        const value = soDigitos(rows[0]?.['v'] ?? rows[0]?.['V']);
        if (value.length !== 14) continue;

        const countRows = await pool.query<{ cnt: number }>(`SELECT COUNT(*) AS CNT FROM ${table}`);
        const rowCount = Number(countRows[0]?.cnt ?? 0);
        // Tabela de config/empresa tem poucas linhas. Muitas = clientes/fornecedores.
        if (rowCount === 0 || rowCount > 10) continue;
        candidates.push({ table, column: field, value, rowCount });
      } catch {
        // tabela/coluna nao acessivel — ignora e segue
      }
    }

    candidates.sort((a, b) => a.rowCount - b.rowCount);
    return candidates[0] ?? null;
  } finally {
    await pool.close();
  }
}
