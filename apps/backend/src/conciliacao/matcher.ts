// Casamento extrato (portal) x sistema (GDOOR) — ver openspec D23/D29.
//
// Regra aprendida na investigacao de 27/08: casar por (dia + valor), usando a hora so como
// desempate. NSU nao serve como chave universal porque o pagamento no GDOOR (MOV_OPERADORES)
// NAO guarda NSU — ele so existe em MOVIMENTACAO_CARTAO, que cobre parte das transacoes.
// O NSU entra no resultado para APONTAR qual transacao divergiu, nao para casar.

export interface LinhaExtrato {
  nsu: string; valor: number; data: string; hora: string;
  adquirente: string; bandeira: string; pdv: string; autorizacao: string;
}
export interface PagamentoSistema {
  id: string; valor: number; data: string; hora: string; forma: string;
}

export type EstadoConciliacao = 'conciliado' | 'so_no_extrato' | 'so_no_sistema';

/** Como a transacao casou: direto na forma esperada, ou noutra forma de cartao (ver D29). */
export type ViaCasamento = 'direto' | 'outra_forma';

export interface ItemConciliado {
  estado: EstadoConciliacao;
  data: string;
  valor: number;
  extrato?: LinhaExtrato;
  sistema?: PagamentoSistema;
  via?: ViaCasamento;
}

export interface ResultadoConciliacao {
  itens: ItemConciliado[];
  porDia: Array<{ data: string; extratoQtd: number; extratoValor: number; sistemaQtd: number; sistemaValor: number; diferenca: number; completo: boolean }>;
  totais: { extratoQtd: number; extratoValor: number; sistemaQtd: number; sistemaValor: number; conciliados: number; soNoExtrato: number; soNoSistema: number; valorSoNoExtrato: number; valorSoNoSistema: number };
  diasIgnorados: string[]; // dias sem NENHUM pagamento no sistema — sincronizacao incompleta
}

const cent = (v: number): number => Math.round(v * 100);
const hhmmss = (h: string): number => { const [a = '0', b = '0', c = '0'] = (h || '').split(':'); return +a * 3600 + +b * 60 + +c; };

/**
 * Casa extrato x sistema. Dia em que o sistema nao tem NENHUM pagamento e IGNORADO (entra em
 * `diasIgnorados`), nunca vira "so_no_extrato": foi assim que a copia desatualizada do banco
 * fez 3 dias parecerem R$13.720 de divergencia em 27/08 — era so o agente nao ter sincronizado.
 */
export function conciliar(
  extrato: LinhaExtrato[],
  sistema: PagamentoSistema[],
  /**
   * Outras formas de cartao do mesmo dia (ex.: `CREDITO ENTREGA`). Sao a SEGUNDA chance de uma
   * transacao antes de ser acusada de "cobrou e nao virou venda": em 03/08 uma venda passada na
   * maquininha do TEF estava registrada como `CREDITO ENTREGA` e teria virado falso alarme (D29).
   * Nao entram nos totais do sistema nem geram `so_no_sistema` — so absorvem sobra.
   */
  fallback: PagamentoSistema[] = [],
  /**
   * Dia 'YYYY-MM-DD' a partir do qual NAO se julga nada (inclusive). E o ultimo dia que o
   * agente sincronizou: como o sync anda por ID crescente, esse dia pode estar pela METADE.
   * Sem isso, 24/08 (57 de 103 pagamentos sincronizados) gerou 46 falsas "cobrancas perdidas"
   * em producao (27/08) — o dia nao estava vazio, entao a regra de "dia sem pagamento" nao
   * pegava. Dia incompleto e pior que dia vazio: parece dado bom.
   */
  ignorarAPartirDe?: string,
): ResultadoConciliacao {
  const dias = [...new Set([...extrato.map((e) => e.data), ...sistema.map((s) => s.data)])].filter(Boolean).sort();
  const itens: ItemConciliado[] = [];
  const porDia: ResultadoConciliacao['porDia'] = [];
  const diasIgnorados: string[] = [];

  for (const dia of dias) {
    const ex = extrato.filter((e) => e.data === dia);
    const si = sistema.filter((s) => s.data === dia);
    const exValor = ex.reduce((a, e) => a + e.valor, 0);
    const siValor = si.reduce((a, s) => a + s.valor, 0);
    const completo = si.length > 0 && !(ignorarAPartirDe && dia >= ignorarAPartirDe);
    porDia.push({ data: dia, extratoQtd: ex.length, extratoValor: exValor, sistemaQtd: si.length, sistemaValor: siValor, diferenca: exValor - siValor, completo });
    if (!completo) { diasIgnorados.push(dia); continue; }

    // agrupa por valor em centavos; dentro do grupo casa pela hora mais proxima
    const porValor = new Map<number, PagamentoSistema[]>();
    for (const s of si) {
      const k = cent(s.valor);
      porValor.set(k, [...(porValor.get(k) ?? []), s]);
    }
    const fbDia = new Map<number, PagamentoSistema[]>();
    for (const f of fallback.filter((f) => f.data === dia)) {
      const k = cent(f.valor);
      fbDia.set(k, [...(fbDia.get(k) ?? []), f]);
    }
    for (const e of ex) {
      const cand = porValor.get(cent(e.valor));
      if (!cand || cand.length === 0) {
        // segunda chance: a venda pode ter sido registrada noutra forma de cartao (D29)
        const alt = fbDia.get(cent(e.valor));
        if (alt && alt.length > 0) {
          itens.push({ estado: 'conciliado', data: dia, valor: e.valor, extrato: e, sistema: alt.shift()!, via: 'outra_forma' });
          continue;
        }
        itens.push({ estado: 'so_no_extrato', data: dia, valor: e.valor, extrato: e });
        continue;
      }
      cand.sort((a, b) => Math.abs(hhmmss(a.hora) - hhmmss(e.hora)) - Math.abs(hhmmss(b.hora) - hhmmss(e.hora)));
      const casado = cand.shift()!;
      itens.push({ estado: 'conciliado', data: dia, valor: e.valor, extrato: e, sistema: casado, via: 'direto' });
    }
    for (const restantes of porValor.values()) {
      for (const s of restantes) itens.push({ estado: 'so_no_sistema', data: dia, valor: s.valor, sistema: s });
    }
  }

  const soEx = itens.filter((i) => i.estado === 'so_no_extrato');
  const soSi = itens.filter((i) => i.estado === 'so_no_sistema');
  return {
    itens,
    porDia,
    totais: {
      extratoQtd: extrato.length, extratoValor: extrato.reduce((a, e) => a + e.valor, 0),
      sistemaQtd: sistema.length, sistemaValor: sistema.reduce((a, s) => a + s.valor, 0),
      conciliados: itens.filter((i) => i.estado === 'conciliado').length,
      soNoExtrato: soEx.length, soNoSistema: soSi.length,
      valorSoNoExtrato: soEx.reduce((a, i) => a + i.valor, 0),
      valorSoNoSistema: soSi.reduce((a, i) => a + i.valor, 0),
    },
    diasIgnorados,
  };
}
