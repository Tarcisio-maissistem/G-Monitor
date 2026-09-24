import { Prisma, type PrismaClient } from '@prisma/client';

// Operadores de caixa (pedido do dono 24/09, openspec/changes/operadores-caixa): o que passou por
// cada operador/vendedor e, em toda ocorrencia ("erro"), QUEM lancou a venda.

export type TipoOcorrencia = 'cancelada' | 'sem_itens' | 'pre_venda_zerada' | 'desconto' | 'pago_a_menor';

export interface VendaLinha {
  id: string;
  sourceId: string;
  saleDate: Date;
  saleHour: number | null;
  operador: string;
  vendedor: string;
  caixa: string | null;
  total: number;
  cancelada: boolean;
  itens: number | null;   // soma dos itens (null = sem item sincronizado)
  nItens: number;
  pago: number | null;    // soma dos pagamentos VINCULADOS (null = nenhum vinculado)
}

export interface Ocorrencia {
  tipo: TipoOcorrencia;
  vendaId: string;
  vendaNumero: string;    // numero da venda no GDOOR (sourceId)
  dia: string;            // YYYY-MM-DD
  hora: number | null;
  operador: string;
  vendedor: string;
  caixa: string | null;
  valor: number;          // valor da venda
  diferenca: number;      // o que "falta": desconto, valor cancelado, pago a menor...
  detalhe: string;
}

const TOLERANCIA = 0.05; // centavos de arredondamento do GDOOR

/** Ocorrencias de UMA venda. Pura: testada em operadores.test.ts. */
export function classificarVenda(v: VendaLinha, limiteDescontoPct: number): Array<Omit<Ocorrencia, 'vendaId' | 'vendaNumero' | 'dia' | 'hora' | 'operador' | 'vendedor' | 'caixa' | 'valor'>> {
  const out: Array<{ tipo: TipoOcorrencia; diferenca: number; detalhe: string }> = [];
  if (v.cancelada) {
    out.push({ tipo: 'cancelada', diferenca: v.total, detalhe: 'Venda cancelada' });
    return out; // cancelada: o resto nao importa
  }
  if (v.nItens === 0 && v.total > TOLERANCIA) {
    out.push({ tipo: 'sem_itens', diferenca: v.total, detalhe: 'Venda sem itens sincronizados' });
  }
  if (v.total <= TOLERANCIA && v.nItens > 0) {
    out.push({ tipo: 'pre_venda_zerada', diferenca: v.itens ?? 0, detalhe: 'Total zero com itens (pré-venda não finalizada?)' });
  }
  if (v.nItens > 0 && v.total > TOLERANCIA && v.itens != null) {
    const desconto = v.itens - v.total;
    const pct = v.itens > 0 ? (desconto / v.itens) * 100 : 0;
    // ate a Fase 2 (item cancelado nao sincroniza) um item cancelado tambem aparece aqui
    if (desconto > TOLERANCIA && pct > limiteDescontoPct) {
      out.push({ tipo: 'desconto', diferenca: desconto, detalhe: `Desconto de ${pct.toFixed(1)}% (ou item cancelado)` });
    }
  }
  // Pago A MAIOR em dinheiro e troco — so pago a MENOR e ocorrencia. Sem pagamento vinculado
  // nao conta (e lacuna de sincronizacao, nao erro do operador).
  if (v.pago != null && v.total - v.pago > TOLERANCIA) {
    out.push({ tipo: 'pago_a_menor', diferenca: v.total - v.pago, detalhe: 'Pagamentos somam menos que a venda' });
  }
  return out;
}

export interface ResumoPessoa {
  nome: string;
  vendas: number;          // vendas validas (nao canceladas, total > 0)
  total: number;
  ticketMedio: number;
  canceladas: number;
  valorCancelado: number;
  descontos: number;
  valorDesconto: number;
  ocorrencias: number;
  porTipo: Record<TipoOcorrencia, number>;
}

function novoResumo(nome: string): ResumoPessoa {
  return {
    nome, vendas: 0, total: 0, ticketMedio: 0, canceladas: 0, valorCancelado: 0, descontos: 0, valorDesconto: 0, ocorrencias: 0,
    porTipo: { cancelada: 0, sem_itens: 0, pre_venda_zerada: 0, desconto: 0, pago_a_menor: 0 },
  };
}

/** Agrega vendas + ocorrencias por pessoa (operador ou vendedor). Pura. */
export function agregar(vendas: VendaLinha[], chave: 'operador' | 'vendedor', limiteDescontoPct: number): ResumoPessoa[] {
  const mapa = new Map<string, ResumoPessoa>();
  for (const v of vendas) {
    const nome = v[chave];
    const r = mapa.get(nome) ?? novoResumo(nome);
    mapa.set(nome, r);
    if (!v.cancelada && v.total > TOLERANCIA) { r.vendas += 1; r.total += v.total; }
    for (const o of classificarVenda(v, limiteDescontoPct)) {
      r.ocorrencias += 1;
      r.porTipo[o.tipo] += 1;
      if (o.tipo === 'cancelada') { r.canceladas += 1; r.valorCancelado += o.diferenca; }
      if (o.tipo === 'desconto') { r.descontos += 1; r.valorDesconto += o.diferenca; }
    }
  }
  for (const r of mapa.values()) r.ticketMedio = r.vendas > 0 ? r.total / r.vendas : 0;
  return [...mapa.values()].sort((a, b) => b.total - a.total);
}

const MAX_OCORRENCIAS = 500;

export async function relatorioOperadores(prisma: PrismaClient, p: {
  tenantId: string; storeId: string | null; from: Date; to: Date; operador?: string | undefined; limiteDescontoPct: number;
}) {
  // 1 consulta: cada venda do periodo com a soma dos itens e dos pagamentos vinculados.
  // NFC-e (modelo 65) fica fora: ela repete o PV (auditoria 04/09).
  const rows = await prisma.$queryRaw<Array<{
    id: string; sourceId: string; saleDate: Date; saleHour: number | null; operador: string; vendedor: string; caixa: string | null;
    total: unknown; cancelled: boolean; itens: unknown; n_itens: bigint; pago: unknown;
  }>>(Prisma.sql`
    SELECT s.id, s."sourceId", s."saleDate", s."saleHour",
           COALESCE(NULLIF(UPPER(TRIM(s."operatorName")), ''), '(sem operador)') AS operador,
           COALESCE(NULLIF(UPPER(TRIM(s."sellerName")), ''), '(sem vendedor)') AS vendedor,
           NULLIF(TRIM(s.caixa), '') AS caixa, s."totalValue" AS total, s.cancelled,
           i.itens, COALESCE(i.n_itens, 0) AS n_itens, pg.pago
    FROM sales s
    LEFT JOIN LATERAL (SELECT SUM(it."totalValue") AS itens, COUNT(*) AS n_itens FROM sale_items it WHERE it."saleId" = s.id) i ON true
    LEFT JOIN LATERAL (SELECT SUM(pa.value) AS pago FROM payments pa WHERE pa."saleId" = s.id) pg ON true
    WHERE s."tenantId" = ${p.tenantId} ${p.storeId ? Prisma.sql`AND s."storeId" = ${p.storeId}` : Prisma.empty}
      AND s."saleDate" >= ${p.from} AND s."saleDate" <= ${p.to}
      AND NOT (COALESCE(TRIM(s.modelo), '') LIKE '65%')
    ORDER BY s."saleDate" DESC, s."sourceId" DESC`);

  const num = (x: unknown): number => (x == null ? 0 : Number(x));
  const vendas: VendaLinha[] = rows.map((r) => ({
    id: r.id, sourceId: r.sourceId, saleDate: r.saleDate, saleHour: r.saleHour, operador: r.operador, vendedor: r.vendedor,
    caixa: r.caixa, total: num(r.total), cancelada: r.cancelled, itens: r.itens == null ? null : num(r.itens),
    nItens: Number(r.n_itens), pago: r.pago == null ? null : num(r.pago),
  }));

  const operadores = agregar(vendas, 'operador', p.limiteDescontoPct);
  const vendedores = agregar(vendas, 'vendedor', p.limiteDescontoPct);

  // Ocorrencias (filtradas pelo operador escolhido na tela), mais recentes primeiro
  const ocorrencias: Ocorrencia[] = [];
  let totalOcorrencias = 0;
  for (const v of vendas) {
    if (p.operador && v.operador !== p.operador) continue;
    for (const o of classificarVenda(v, p.limiteDescontoPct)) {
      totalOcorrencias += 1;
      if (ocorrencias.length >= MAX_OCORRENCIAS) continue;
      ocorrencias.push({
        ...o, vendaId: v.id, vendaNumero: v.sourceId, dia: v.saleDate.toISOString().slice(0, 10), hora: v.saleHour,
        operador: v.operador, vendedor: v.vendedor, caixa: v.caixa, valor: v.total,
      });
    }
  }

  // Fechamentos de caixa por operador (abertos = sem closedAt)
  const fech = await prisma.$queryRaw<Array<{ operador: string; fechados: bigint; abertos: bigint }>>(Prisma.sql`
    -- o fechamento guarda o ID do usuario do GDOOR; o nome vem de gdoor_users (agente >= 0.9.11)
    SELECT COALESCE(NULLIF(UPPER(TRIM(u.nome)), ''), NULLIF(UPPER(TRIM(c."operatorName")), ''), '(sem operador)') AS operador,
           COUNT(*) FILTER (WHERE c."closedAt" IS NOT NULL) AS fechados,
           COUNT(*) FILTER (WHERE c."closedAt" IS NULL) AS abertos
    FROM cash_closings c
    LEFT JOIN gdoor_users u ON u."tenantId" = c."tenantId" AND u."storeId" = c."storeId" AND u."sourceId" = TRIM(c."operatorName")
    WHERE c."tenantId" = ${p.tenantId} ${p.storeId ? Prisma.sql`AND c."storeId" = ${p.storeId}` : Prisma.empty}
      AND COALESCE(c."closedAt", c."openedAt") >= ${p.from} AND COALESCE(c."closedAt", c."openedAt") <= ${p.to}
    GROUP BY 1`);
  const fechamentos = fech.map((f) => ({ operador: f.operador, fechados: Number(f.fechados), abertos: Number(f.abertos) }));

  const totais = operadores.reduce((a, r) => ({
    vendas: a.vendas + r.vendas, total: a.total + r.total, canceladas: a.canceladas + r.canceladas,
    valorCancelado: a.valorCancelado + r.valorCancelado, ocorrencias: a.ocorrencias + r.ocorrencias,
  }), { vendas: 0, total: 0, canceladas: 0, valorCancelado: 0, ocorrencias: 0 });

  return {
    periodo: { from: p.from.toISOString().slice(0, 10), to: p.to.toISOString().slice(0, 10) },
    limiteDescontoPct: p.limiteDescontoPct,
    totais,
    operadores,
    vendedores,
    fechamentos,
    ocorrencias,
    totalOcorrencias,
    ocorrenciasTruncadas: totalOcorrencias > ocorrencias.length,
    avisos: [
      'Desconto inclui item cancelado até o agente novo trazer o cancelamento por item.',
      'Pagamento sem vínculo com a venda não conta como ocorrência (é lacuna de sincronização).',
    ],
  };
}
