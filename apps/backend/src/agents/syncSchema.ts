import { z } from 'zod';

// Payload do POST /api/agent/sync. Modulo puro (sem config/banco) para poder ser testado isolado.
export const syncBatchSchema = z.object({
  // recent=true: reenvio da JANELA RECENTE (linhas alteradas: cancelamento, baixa, edicao).
  // Nao avanca checkpoint nem conta no ritmo — o agente manda no maximo 1 por tabela por tick.
  recent: z.boolean().optional(),
  table: z.enum([
    'sales',
    'saleItems',
    'payments',
    'customers',
    'products',
    'cashClosings',
    'cashClosingSpecies',
    'cardTransactions',
    'payables',
    'receivables',
  ]),
  // 24/09: a janela recente do agente 0.9.8 manda ate 5000 linhas num lote so (FIRST 2000/5000);
  // com max(1000) o servidor recusava TODAS (ZodError 500, ~4 mil vezes de 20 a 22/09) e
  // cancelamento/baixa/fechamento alterado nunca atualizava. Lote normal segue limitado a 1000.
  rows: z.array(z.record(z.unknown())).max(5000),
  checkpoint: z.string(),
}).refine((b) => b.recent || b.rows.length <= 1000, {
  message: 'Lote incremental aceita no maximo 1000 linhas (so a janela recente vai ate 5000)',
  path: ['rows'],
});
