import { Prisma, type PrismaClient } from '@prisma/client';
import type { ItemConciliado } from './matcher.js';

// Quem lancou cada inconsistencia da conciliacao (gestor da Casa J.Kastros, 24/09): "esse valor
// aqui, quem que era? Camila, Gilsa, Maria Eduarda...". Duas situacoes:
//  - SO NO SISTEMA: o pagamento esta no GDOOR -> a venda dele diz operador/vendedor/caixa. Certo.
//  - SO NA MAQUININHA: nao ha venda -> o operador PROVAVEL e quem vendia naquele caixa (PDV do
//    extrato) naquela hora. Marcado como provavel na tela, nunca como fato.

export interface QuemLancou {
  operador: string | null;
  vendedor: string | null;
  caixa: string | null;
  venda: string | null;   // numero da venda no GDOOR
  hora: number | null;    // hora da venda (o pagamento so tem data)
  provavel: boolean;
}

const digitos = (s: string | null | undefined): string => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '');

/** Operador mais frequente entre as vendas do caixa/hora (pura, testada). */
export function operadorProvavel(
  vendas: Array<{ operador: string | null; vendedor: string | null; caixa: string | null; hora: number | null }>,
  pdv: string, hora: number,
): QuemLancou | null {
  const naHora = vendas.filter((v) => v.hora === hora && v.operador);
  if (naHora.length === 0) return null;
  // mesmo caixa do PDV do extrato, se o numero bater; senao, qualquer caixa naquela hora
  const doCaixa = naHora.filter((v) => digitos(v.caixa) !== '' && digitos(v.caixa) === digitos(pdv));
  const base = doCaixa.length ? doCaixa : naHora;
  const cont = new Map<string, number>();
  for (const v of base) cont.set(v.operador!, (cont.get(v.operador!) ?? 0) + 1);
  const [operador] = [...cont.entries()].sort((a, b) => b[1] - a[1])[0]!;
  const ex = base.find((v) => v.operador === operador)!;
  return { operador, vendedor: null, caixa: doCaixa.length ? ex.caixa : null, venda: null, hora, provavel: true };
}

export async function anexarQuemLancou(
  prisma: PrismaClient, tenantId: string, problemas: ItemConciliado[],
): Promise<Array<ItemConciliado & { quem: QuemLancou | null }>> {
  if (problemas.length === 0) return [];
  // so no sistema: pagamento -> venda
  const idsPag = problemas.map((p) => p.sistema?.id).filter((x): x is string => !!x);
  // SQL direto: operador/caixa do pagamento sao colunas gravadas pelo sync em SQL cru (fora do model)
  const pags = idsPag.length ? await prisma.$queryRaw<Array<{
    id: string; operador: string | null; caixa: string | null;
    venda: string | null; s_operador: string | null; s_vendedor: string | null; s_caixa: string | null; s_hora: number | null;
  }>>(Prisma.sql`
    SELECT p.id, p.operador, p.caixa, s."sourceId" AS venda, s."operatorName" AS s_operador,
           s."sellerName" AS s_vendedor, s.caixa AS s_caixa, s."saleHour" AS s_hora
    FROM payments p LEFT JOIN sales s ON s.id = p."saleId"
    WHERE p."tenantId" = ${tenantId} AND p.id IN (${Prisma.join(idsPag)})`) : [];
  const porPag = new Map(pags.map((p) => [p.id, p]));

  // so na maquininha: vendas dos dias envolvidos (hora + caixa + operador)
  const dias = [...new Set(problemas.filter((p) => p.estado === 'so_no_extrato').map((p) => p.data))];
  const vendasDia = new Map<string, Array<{ operador: string | null; vendedor: string | null; caixa: string | null; hora: number | null }>>();
  for (const dia of dias) {
    const vs = await prisma.sale.findMany({
      where: { tenantId, cancelled: false, saleDate: { gte: new Date(`${dia}T00:00:00Z`), lte: new Date(`${dia}T23:59:59Z`) } },
      select: { operatorName: true, sellerName: true, caixa: true, saleHour: true },
    });
    vendasDia.set(dia, vs.map((v) => ({ operador: v.operatorName?.trim().toUpperCase() || null, vendedor: v.sellerName, caixa: v.caixa, hora: v.saleHour })));
  }

  return problemas.map((p) => {
    if (p.sistema) {
      const pg = porPag.get(p.sistema.id);
      return {
        ...p,
        quem: pg ? {
          operador: pg.s_operador?.trim().toUpperCase() || pg.operador || null,
          vendedor: pg.s_vendedor?.trim().toUpperCase() || null,
          caixa: pg.s_caixa ?? pg.caixa ?? null,
          venda: pg.venda ?? null,
          hora: pg.s_hora ?? null,
          provavel: false,
        } : null,
      };
    }
    if (p.extrato) {
      const hora = Number(String(p.extrato.hora ?? '').slice(0, 2));
      return { ...p, quem: Number.isFinite(hora) ? operadorProvavel(vendasDia.get(p.data) ?? [], p.extrato.pdv, hora) : null };
    }
    return { ...p, quem: null };
  });
}
