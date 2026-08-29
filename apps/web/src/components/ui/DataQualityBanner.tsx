import type { CashflowQuality, DreLine, FreshnessMeta } from '../../lib/reports';
import { TABELA_LABEL } from '../../lib/reports';

export type QualityKind = 'info' | 'warn' | 'error';

export interface QualityItem {
  label: string;
  kind: QualityKind;
}

export interface DataQualityBannerProps {
  // Avisos derivados do objeto quality/status do endpoint (ver qualityToItems). O banner
  // NAO tem texto fixo proprio: lista vazia + meta ok = nao renderiza nada.
  items?: QualityItem[] | undefined;
  meta?: Partial<FreshnessMeta> | null | undefined;
  className?: string;
}

// Defasagem (D7 / data-sync spec): banner quando o agente nao e visto ha > 5 min.
export const STALENESS_LIMIT_SECONDS = 300;

// meta -> avisos de infraestrutura (agente offline, dado defasado).
export function metaToItems(meta: Partial<FreshnessMeta> | null | undefined): QualityItem[] {
  if (!meta) return [];
  const out: QualityItem[] = [];
  const offline = meta.agentsOffline ?? [];
  if (offline.length > 0) out.push({ kind: 'error', label: `${offline.length} agente${offline.length > 1 ? 's' : ''} offline — dados podem estar parados.` });
  const s = meta.stalenessSeconds;
  if (s != null && s > STALENESS_LIMIT_SECONDS) {
    out.push({ kind: 'warn', label: `Dados sincronizados há ${Math.round(s / 60)} min — pode haver defasagem.` });
  }
  // Tabelas que ainda nao chegaram: o usuario entende por que ha "—" na tela (dono 28/08).
  if (meta.tabelasSincronizadas) {
    const faltam = (['sales', 'saleItems', 'payments', 'payables', 'receivables', 'cashClosings'] as const)
      .filter((t) => !meta.tabelasSincronizadas!.includes(t)).map((t) => TABELA_LABEL[t]);
    if (faltam.length > 0) out.push({ kind: 'info', label: `Ainda não sincronizado nesta loja: ${faltam.join(', ')}. Onde aparece "—", o dado ainda não chegou.` });
  }
  return out;
}

// quality{} do /cashflow -> avisos. Cada frase so aparece quando o backend LIGOU a flag
// naquele dado (nao e string fixa da tela). Chaves desconhecidas sao ignoradas de proposito:
// melhor faltar um aviso do que mostrar chave crua pro dono de loja.
export function qualityToItems(q: Partial<CashflowQuality> | null | undefined): QualityItem[] {
  if (!q) return [];
  const out: QualityItem[] = [];
  if (q.paymentsRecentes === false) out.push({ kind: 'error', label: 'Nenhum pagamento de venda chegou nos últimos 2 dias com o agente online — confira o sync de pagamentos.' });
  if (q.saidasParciais) out.push({ kind: 'warn', label: 'Saídas = só contas a pagar baixadas. Sangria e despesa de caixa ainda não sincronizam.' });
  if (q.semSaldoInicial) out.push({ kind: 'info', label: 'Sem saldo inicial de caixa: o valor é a variação do período, não o saldo em caixa.' });
  if (q.crediarioExcluidoDasVendas) out.push({ kind: 'info', label: 'Crediário entra no caixa só quando o título é baixado (não na data da venda).' });
  if ((q.avulsosNaoClassificados ?? 0) > 0) {
    out.push({ kind: 'warn', label: `${q.avulsosNaoClassificados} recebimento(s) sem venda vinculada contados como estimativa (linha "avulsos").` });
  }
  if (q.baixaParcialUnicaData) out.push({ kind: 'info', label: 'Baixa parcial em datas diferentes não é representada — título conta na última data de baixa.' });
  return out;
}

// lines[] da DRE -> "X de N linhas com dado real" + notas das linhas N/D (P3).
export function dreLinesToItems(lines: DreLine[] | null | undefined): QualityItem[] {
  if (!lines || lines.length === 0) return [];
  const real = lines.filter((l) => l.status === 'real').length;
  const nd = lines.filter((l) => l.status === 'nd').map((l) => l.label);
  const out: QualityItem[] = [{ kind: real === lines.length ? 'info' : 'warn', label: `${real} de ${lines.length} linhas com dado real. O resultado é aproximado, não é lucro.` }];
  if (nd.length > 0) out.push({ kind: 'info', label: `Sem dado sincronizado: ${nd.join(', ')}.` });
  return out;
}

const KIND_STYLE: Record<QualityKind, { box: string; icon: string }> = {
  error: { box: 'bg-red-50 border-red-300 text-red-800', icon: '⛔' },
  warn: { box: 'bg-amber-50 border-amber-300 text-amber-900', icon: '⚠' },
  info: { box: 'bg-slate-50 border-slate-200 text-slate-700', icon: 'ℹ' },
};

// UM banner por tela (substitui os 2 banners soltos do Dashboard). A cor e a do aviso mais
// grave; os itens viram uma lista curta. Renderiza null quando nao ha nada a dizer.
export function DataQualityBanner({ items, meta, className = '' }: DataQualityBannerProps): JSX.Element | null {
  const all = [...metaToItems(meta), ...(items ?? [])];
  if (all.length === 0) return null;
  const worst: QualityKind = all.some((i) => i.kind === 'error') ? 'error' : all.some((i) => i.kind === 'warn') ? 'warn' : 'info';
  const style = KIND_STYLE[worst];

  if (all.length === 1) {
    const only = all[0]!;
    return (
      <div className={`border rounded-lg px-3 py-2 text-sm ${style.box} ${className}`}>
        {KIND_STYLE[only.kind].icon} {only.label}
      </div>
    );
  }
  return (
    <div className={`border rounded-lg px-3 py-2 text-sm ${style.box} ${className}`}>
      <ul className="space-y-1">
        {all.map((i, idx) => (
          <li key={idx} className="flex gap-2">
            <span className="shrink-0">{KIND_STYLE[i.kind].icon}</span>
            <span>{i.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
