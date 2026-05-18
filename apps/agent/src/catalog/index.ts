// Catalogo de queries pre-aprovadas.
// Cada entrada: id -> { sql, params: [Zod schemas], minFirebirdVersion? }
// O agente SOMENTE executa queries deste catalogo. Backend envia reportId, nao SQL.
// O catalogo é versionado e (em prod) carregado de arquivo assinado Ed25519.

import { z } from 'zod';

export interface CatalogEntry {
  id: string;
  sql: string;
  paramSchema: z.ZodObject<z.ZodRawShape>;
  description: string;
  minVersion?: string;
}

const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CATALOG: Record<string, CatalogEntry> = {
  'sales-summary': {
    id: 'sales-summary',
    description: 'Resumo de vendas no periodo',
    paramSchema: z.object({ from: dateParam, to: dateParam }),
    sql: `
      SELECT
        COUNT(*) AS QTD,
        COALESCE(SUM(VALOR_TOT_NOTA), 0) AS TOTAL,
        COALESCE(AVG(VALOR_TOT_NOTA), 0) AS TICKET,
        COUNT(DISTINCT CLIENTE) AS CLIENTES,
        COUNT(DISTINCT DATA_EMISSAO) AS DIAS
      FROM VENDAS
      WHERE COALESCE(CANCELADA, 0) = 0
        AND PROCESSADA = 1
        AND DATA_EMISSAO BETWEEN ? AND ?
    `,
  },
  'sales-by-payment': {
    id: 'sales-by-payment',
    description: 'Vendas agrupadas por forma de pagamento',
    paramSchema: z.object({ from: dateParam, to: dateParam }),
    sql: `
      SELECT
        UPPER(TRIM(COALESCE(P.FORMA_XML, M.ESPECIE))) AS FORMA,
        COUNT(DISTINCT V.ID) AS QTD,
        COALESCE(SUM(M.VALOR), 0) AS VALOR
      FROM VENDAS V
      JOIN MOV_OPERADORES M ON M.ID_VENDA = V.ID AND UPPER(TRIM(M.ESPECIE)) <> 'TROCO'
      LEFT JOIN (
        SELECT UPPER(TRIM(ESPECIE)) AS ESP, MAX(UPPER(TRIM(FORMA_XML))) AS FORMA_XML
        FROM PDV_ESPECIES GROUP BY 1
      ) P ON UPPER(TRIM(M.ESPECIE)) = P.ESP
      WHERE COALESCE(V.CANCELADA, 0) = 0
        AND V.PROCESSADA = 1
        AND V.DATA_EMISSAO BETWEEN ? AND ?
      GROUP BY 1
      ORDER BY VALOR DESC
    `,
  },
  'sync-sales-batch': {
    id: 'sync-sales-batch',
    description: 'Pagina de vendas para sincronizacao incremental',
    paramSchema: z.object({ afterId: z.number().int().nonnegative(), limit: z.number().int().positive().max(1000) }),
    sql: `
      SELECT FIRST ? V.ID AS SOURCE_ID, V.DATA_EMISSAO AS SALE_DATE, V.CLIENTE AS CUSTOMER_SOURCE_ID,
             V.OPERADOR AS OPERATOR_NAME, V.CAIXA, V.MODELO, V.NATUREZA,
             V.VALOR_TOT_NOTA AS TOTAL_VALUE, V.CANCELADA AS CANCELLED, V.PROCESSADA AS PROCESSED
      FROM VENDAS V
      WHERE V.ID > ?
      ORDER BY V.ID ASC
    `,
  },
  'ping-db': {
    id: 'ping-db',
    description: 'Health check Firebird',
    paramSchema: z.object({}),
    sql: 'SELECT 1 AS OK FROM RDB$DATABASE',
  },
};

export function resolveReport(id: string): CatalogEntry | null {
  return CATALOG[id] ?? null;
}
