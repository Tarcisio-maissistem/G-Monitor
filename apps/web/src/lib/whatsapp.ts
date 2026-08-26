// Monta texto no formato do WhatsApp (*negrito*, _italico_, sem HTML) — pedido do dono
// 24/08, pra mandar o resumo direto pro grupo/cliente sem redigitar numero.
// Generico: substitui as versoes locais de DashboardPage (3 secoes) e ContasPagar/Receber
// (resumo + lista limitada). A pagina so descreve titulo/periodo/linhas; formatacao fica aqui.
import { formatBRL } from './masks';

export interface WhatsAppLinha {
  label: string;
  // number vira BRL automaticamente; string entra como esta (ex: "12 vendas", "35%").
  value?: string | number | null;
  bold?: boolean; // *valor* em negrito (destaque do numero principal)
  emoji?: string; // prefixo opcional ("💰")
}

export interface WhatsAppSecao {
  titulo: string;
  linhas: Array<WhatsAppLinha | string>;
  // Corta a lista e acrescenta "_...e mais N_" (padrao 15, como ContasPagar) — mensagem
  // gigante nao serve pra ninguem.
  max?: number;
}

export interface WhatsAppResumoInput {
  titulo: string;
  emoji?: string; // antes do titulo ("📤")
  periodo?: string; // "01/08 a 25/08/2026" (ver periodLabel em lib/period)
  linhas?: Array<WhatsAppLinha | string>; // bloco principal, logo abaixo do titulo
  secoes?: WhatsAppSecao[];
  vazio?: string; // texto quando nao ha linhas nem secoes (ex: "Nenhuma venda no periodo.")
  rodape?: string | null; // null = sem rodape; padrao "_Gerado pelo G-Monitor_"
}

function renderLinha(l: WhatsAppLinha | string): string {
  if (typeof l === 'string') return l;
  const prefix = l.emoji ? `${l.emoji} ` : '';
  if (l.value == null) return `${prefix}${l.label}`;
  const v = typeof l.value === 'number' ? formatBRL(l.value) : l.value;
  return `${prefix}${l.label}: ${l.bold ? `*${v}*` : v}`;
}

export function buildWhatsAppResumo(input: WhatsAppResumoInput): string {
  const head = `${input.emoji ? `${input.emoji} ` : ''}*${input.titulo}*${input.periodo ? ` — ${input.periodo}` : ''}`;
  const out: string[] = [head, ''];

  const linhas = input.linhas ?? [];
  const secoes = (input.secoes ?? []).filter((s) => s.linhas.length > 0);

  if (linhas.length === 0 && secoes.length === 0) {
    out.push(input.vazio ?? 'Sem dados no período.');
  } else {
    for (const l of linhas) out.push(renderLinha(l));
    for (const s of secoes) {
      if (out[out.length - 1] !== '') out.push('');
      out.push(`*${s.titulo}*`);
      const max = s.max ?? 15;
      for (const l of s.linhas.slice(0, max)) out.push(renderLinha(l));
      if (s.linhas.length > max) out.push(`_...e mais ${s.linhas.length - max} item(ns)_`);
    }
  }

  if (input.rodape !== null) out.push('', input.rodape ?? '_Gerado pelo G-Monitor_');
  return out.join('\n');
}
