import { createFirebirdPool } from './firebird/client.js';
import type { AgentConfig } from './config.js';

// Autodeteccao do CNPJ da PROPRIA loja no Firebird/GDOOR, pra nao depender de digitar na
// hora de instalar (pedido do dono 25/08). Nao existe tabela/coluna padrao confirmada em
// producao pra isso ainda (ao contrario do schema financeiro, ver schemaDetect.ts) — em vez
// de arriscar um nome de tabela errado, varre RDB$RELATION_FIELDS por QUALQUER coluna que
// pareca CNPJ/CGC em QUALQUER tabela nao-de-sistema, e prefere a tabela com MENOS linhas
// (tabela de configuracao/empresa costuma ter 1 linha; cadastro de clientes/fornecedores
// tem muitas — evita pegar o CNPJ de terceiro em vez do da propria loja).
export interface CnpjCandidate {
  table: string;
  column: string;
  value: string;
  rowCount: number;
}

export async function detectCnpj(fb: AgentConfig['firebird']): Promise<CnpjCandidate | null> {
  const pool = createFirebirdPool({ firebird: fb } as AgentConfig);
  try {
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
        const countRows = await pool.query<{ cnt: number }>(`SELECT COUNT(*) AS CNT FROM ${table}`);
        const rowCount = Number(countRows[0]?.cnt ?? 0);
        // Tabela de config/empresa tem poucas linhas (tipicamente 1). Muitas linhas =
        // provavelmente clientes/fornecedores, nao a propria loja — descarta.
        if (rowCount === 0 || rowCount > 10) continue;

        const rows = await pool.query<Record<string, unknown>>(
          `SELECT FIRST 1 ${field} AS V FROM ${table} WHERE ${field} IS NOT NULL`,
        );
        const raw = rows[0]?.['v'] ?? rows[0]?.['V'];
        const value = raw != null ? String(raw).replace(/[^0-9]/g, '') : '';
        if (value.length === 14) {
          candidates.push({ table, column: field, value, rowCount });
        }
      } catch {
        // tabela/coluna nao acessivel (permissao, tipo incompativel) — ignora e segue
      }
    }

    candidates.sort((a, b) => a.rowCount - b.rowCount);
    return candidates[0] ?? null;
  } finally {
    await pool.close();
  }
}
