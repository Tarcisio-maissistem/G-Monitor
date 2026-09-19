// Extrato do portal com cache POR DIA (pedido do dono, 19/09): "o que ja passou nao muda, baixa
// uma vez so". A consulta do periodo le do banco os dias fechados e so vai ao portal pelos que
// faltam (ou pelo dia de hoje, que ainda esta em andamento).
//
// Cada dia e buscado como uma consulta SEPARADA no portal, numa unica sessao: o filtro do portal e
// por um dia e o conciliador usa outro (D/H Estabelecimento, que pode cair no dia anterior). Se
// buscassemos um intervalo e reparticionassemos pela data da linha, um dia ja fechado poderia
// receber linhas a mais. Guardando pelo dia CONSULTADO, cada dia e sempre exatamente o que o
// portal devolveu para aquele filtro.
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { sessaoPortal, type GetcardRow } from './getcard.js';
import { diasDoPeriodo, diasParaBuscar, hojeBrasilia } from './extratoDias.js';

export interface ExtratoComCache {
  linhas: GetcardRow[];
  paginas: number;
  cache: { doArquivo: number; doPortal: number };
}

export async function extratoDoPeriodo(opts: {
  tenantId: string; user: string; password: string; from: string; to: string;
}): Promise<ExtratoComCache> {
  const periodo = diasDoPeriodo(opts.from, opts.to);
  const dataDe = (d: string): Date => new Date(`${d}T00:00:00Z`);

  const jaTem = await prisma.getcardDia.findMany({
    where: { tenantId: opts.tenantId, fechado: true, dia: { in: periodo.map(dataDe) } },
    select: { dia: true, paginas: true },
  });
  const fechados = new Set(jaTem.map((d) => d.dia.toISOString().slice(0, 10)));
  const faltam = diasParaBuscar(periodo, fechados);
  let paginas = jaTem.reduce((a, d) => a + d.paginas, 0);

  if (faltam.length) {
    const hoje = hojeBrasilia();
    const sessao = await sessaoPortal({ user: opts.user, password: opts.password });
    // 3 dias por vez na mesma sessao: rapido sem martelar o portal do fornecedor
    for (let i = 0; i < faltam.length; i += 3) {
      const bloco = faltam.slice(i, i + 3);
      const resultados = await Promise.all(bloco.map(async (d) => ({ d, r: await sessao.listar(d, d) })));
      for (const { d, r } of resultados) {
        paginas += r.paginas;
        // dia inteiro troca de uma vez: nunca fica metade velho, metade novo
        await prisma.$transaction([
          prisma.getcardLinha.deleteMany({ where: { tenantId: opts.tenantId, dia: dataDe(d) } }),
          prisma.getcardLinha.createMany({
            data: r.linhas.map((l) => ({
              tenantId: opts.tenantId, dia: dataDe(d), pdv: l.pdv, nsu: l.nsu, cartao: l.cartao,
              parcelas: l.parcelas, valor: new Prisma.Decimal(l.valor), adquirente: l.adquirente,
              bandeira: l.bandeira, data: l.data, hora: l.hora, nsuHost: l.nsuHost,
              autorizacao: l.autorizacao, status: l.status, autorizada: l.autorizada,
            })),
          }),
          prisma.getcardDia.upsert({
            where: { tenantId_dia: { tenantId: opts.tenantId, dia: dataDe(d) } },
            // so fecha se o dia ja acabou quando foi baixado; hoje continua aberto
            create: { tenantId: opts.tenantId, dia: dataDe(d), qtd: r.linhas.length, paginas: r.paginas, fechado: d < hoje },
            update: { qtd: r.linhas.length, paginas: r.paginas, fechado: d < hoje, baixadoEm: new Date() },
          }),
        ]);
      }
    }
  }

  const rows = await prisma.getcardLinha.findMany({
    where: { tenantId: opts.tenantId, dia: { in: periodo.map(dataDe) } },
    orderBy: [{ dia: 'asc' }, { nsu: 'asc' }],
  });
  const linhas: GetcardRow[] = rows.map((l) => ({
    pdv: l.pdv, nsu: l.nsu, cartao: l.cartao, parcelas: l.parcelas, valor: Number(l.valor),
    adquirente: l.adquirente, bandeira: l.bandeira, data: l.data, hora: l.hora,
    nsuHost: l.nsuHost, autorizacao: l.autorizacao, status: l.status, autorizada: l.autorizada,
  }));
  return { linhas, paginas, cache: { doArquivo: fechados.size, doPortal: faltam.length } };
}
