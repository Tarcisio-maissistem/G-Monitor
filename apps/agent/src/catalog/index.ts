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
    // SALE_HOUR de HORA_SAIDA (hora real da venda, TIME — pico de movimento) e SELLER_NAME de
    // VENDEDOR (quem vendeu, != OPERADOR do caixa) — confirmados na prod 25/08: HORA_SAIDA 99,9%
    // preenchida, VENDEDOR 64%. EXTRACT(HOUR ...) sai do proprio Firebird pra nao depender de
    // parse de TIME no Node.
    sql: `
      SELECT FIRST ? V.ID AS SOURCE_ID, V.DATA_EMISSAO AS SALE_DATE, V.CLIENTE AS CUSTOMER_SOURCE_ID,
             V.OPERADOR AS OPERATOR_NAME, V.VENDEDOR AS SELLER_NAME, V.CAIXA, V.MODELO, V.NATUREZA,
             CASE WHEN V.HORA_SAIDA IS NULL THEN NULL ELSE EXTRACT(HOUR FROM V.HORA_SAIDA) END AS SALE_HOUR,
             V.VALOR_TOT_NOTA AS TOTAL_VALUE, V.CANCELADA AS CANCELLED, V.PROCESSADA AS PROCESSED
      FROM VENDAS V
      WHERE V.ID > ?
      ORDER BY V.ID ASC
    `,
  },
  // ITEVENDAS/MOV_OPERADORES — CONFIRMADAS em producao (cliente piloto, 23/08) via
  // RDB$RELATION_FIELDS. Alimentam abc-products e sales-by-payment no dashboard (ate
  // 23/08 esses paineis ficavam vazios: agente nunca sincronizava essas 2 tabelas).
  'sync-sale-items-batch': {
    id: 'sync-sale-items-batch',
    description: 'Pagina de itens de venda (ITEVENDAS) para sincronizacao incremental',
    paramSchema: z.object({ afterId: z.number().int().nonnegative(), limit: z.number().int().positive().max(1000) }),
    sql: `
      SELECT FIRST ? I.ID AS SOURCE_ID, I.ID_VENDAS AS SALE_SOURCE_ID, I.CODIGO AS PRODUCT_CODE,
             I.DESCRICAO AS DESCRIPTION, I.QTD AS QUANTITY, I.VALOR_UNITA AS UNIT_VALUE,
             I.VALOR_TOTAL AS TOTAL_VALUE
      FROM ITEVENDAS I
      WHERE I.ID > ?
      ORDER BY I.ID ASC
    `,
  },
  'sync-payments-batch': {
    id: 'sync-payments-batch',
    description: 'Pagina de pagamentos (MOV_OPERADORES) para sincronizacao incremental',
    paramSchema: z.object({ afterId: z.number().int().nonnegative(), limit: z.number().int().positive().max(1000) }),
    sql: `
      SELECT FIRST ? M.ID AS SOURCE_ID, M.ID_VENDA AS SALE_SOURCE_ID, M.DATA AS PAYMENT_DATE,
             UPPER(TRIM(COALESCE(P.FORMA_XML, M.ESPECIE))) AS PAYMENT_TYPE,
             M.ESPECIE AS ESPECIE, M.VALOR AS TOTAL_VALUE
      FROM MOV_OPERADORES M
      LEFT JOIN (
        SELECT UPPER(TRIM(ESPECIE)) AS ESP, MAX(UPPER(TRIM(FORMA_XML))) AS FORMA_XML
        FROM PDV_ESPECIES GROUP BY 1
      ) P ON UPPER(TRIM(M.ESPECIE)) = P.ESP
      WHERE M.ID > ? AND UPPER(TRIM(M.ESPECIE)) <> 'TROCO'
      ORDER BY M.ID ASC
    `,
  },
  // Variante PAGAR/RECEBER — CONFIRMADA em producao (cliente piloto, 22/08): colunas reais
  // via RDB$RELATION_FIELDS, nao suposicao. Ver design.md D11.
  'sync-payables-batch-pagar': {
    id: 'sync-payables-batch-pagar',
    description: 'Pagina de contas a pagar (PAGAR) para sincronizacao incremental',
    paramSchema: z.object({ afterId: z.number().int().nonnegative(), limit: z.number().int().positive().max(1000) }),
    sql: `
      SELECT FIRST ? P.ID AS SOURCE_ID, P.VENCIMENTO AS DUE_DATE, P.VALOR_DUP AS TOTAL_VALUE,
             COALESCE(P.VALOR_PAG, 0) AS PAID_VALUE, P.PAGAMENTO AS PAID_DATE,
             P.NOM_FORNECEDOR AS COUNTERPARTY,
             P.HISTORICO AS DESCRIPTION,
             COALESCE(P.CANCELADA, 0) AS CANCELLED
      FROM PAGAR P
      WHERE P.ID > ?
      ORDER BY P.ID ASC
    `,
  },
  'sync-receivables-batch-receber': {
    id: 'sync-receivables-batch-receber',
    description: 'Pagina de contas a receber (RECEBER) para sincronizacao incremental',
    paramSchema: z.object({ afterId: z.number().int().nonnegative(), limit: z.number().int().positive().max(1000) }),
    sql: `
      SELECT FIRST ? R.ID AS SOURCE_ID, R.VENCIMENTO AS DUE_DATE, R.VALOR_DUP AS TOTAL_VALUE,
             COALESCE(R.VALOR_REC, 0) AS RECEIVED_VALUE, R.RECEBIMENTO AS RECEIVED_DATE,
             R.NOM_CLIENTE AS COUNTERPARTY,
             R.HISTORICO AS DESCRIPTION,
             COALESCE(R.CANCELADA, 0) AS CANCELLED
      FROM RECEBER R
      WHERE R.ID > ?
      ORDER BY R.ID ASC
    `,
  },
  // Variante CONTAS_PAGAR/CONTAS_RECEBER — NAO confirmada em producao ainda (so inferida do
  // codigo legado gdoor-relatorio). Mantida como fallback pra outra instalacao GDOOR que a tenha.
  'sync-payables-batch-contas-pagar': {
    id: 'sync-payables-batch-contas-pagar',
    description: 'Pagina de contas a pagar (CONTAS_PAGAR, variante nao confirmada) para sincronizacao incremental',
    paramSchema: z.object({ afterId: z.number().int().nonnegative(), limit: z.number().int().positive().max(1000) }),
    sql: `
      SELECT FIRST ? C.ID AS SOURCE_ID, C.VENCIMENTO AS DUE_DATE, C.VALOR AS TOTAL_VALUE,
             COALESCE(C.VALOR_PAGO, 0) AS PAID_VALUE, C.DT_PAGTO AS PAID_DATE,
             C.FORNECEDOR AS COUNTERPARTY,
             C.HISTORICO AS DESCRIPTION,
             COALESCE(C.CANCELADA, 0) AS CANCELLED
      FROM CONTAS_PAGAR C
      WHERE C.ID > ?
      ORDER BY C.ID ASC
    `,
  },
  'sync-receivables-batch-contas-receber': {
    id: 'sync-receivables-batch-contas-receber',
    description: 'Pagina de contas a receber (CONTAS_RECEBER, variante nao confirmada) para sincronizacao incremental',
    paramSchema: z.object({ afterId: z.number().int().nonnegative(), limit: z.number().int().positive().max(1000) }),
    sql: `
      SELECT FIRST ? C.ID AS SOURCE_ID, C.VENCIMENTO AS DUE_DATE, C.VALOR AS TOTAL_VALUE,
             COALESCE(C.VALOR_RECEBIDO, 0) AS RECEIVED_VALUE, C.DT_RECEBIMENTO AS RECEIVED_DATE,
             C.CLIENTE AS COUNTERPARTY,
             C.HISTORICO AS DESCRIPTION,
             COALESCE(C.CANCELADA, 0) AS CANCELLED
      FROM CONTAS_RECEBER C
      WHERE C.ID > ?
      ORDER BY C.ID ASC
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
