import { useEffect, useRef, useState, type ReactNode } from 'react';

export type KpiTone = 'default' | 'blue' | 'emerald' | 'red' | 'amber' | 'slate';

export interface KpiCardProps {
  label: string;
  // Valor JA formatado (formatBRL/formatInt de lib/masks) — o card nao adivinha se e
  // dinheiro ou contagem. Aceita ReactNode pra permitir badge inline.
  value: ReactNode;
  tone?: KpiTone; // cor do valor (a pagar azul, vencido vermelho, entradas verde...)
  sub?: string | undefined; // linha pequena abaixo do valor ("12 vendas", "= contas a pagar baixadas")
  highlight?: boolean; // card principal (borda azul + valor azul) — variante do Dashboard
  compact?: boolean; // padding/fonte menores pra caber 3 cards em 375px
  badge?: ReactNode; // selo no canto (ex: <DataStatusBadge status="estimate" />)
  // Texto do ⓘ (pedido do dono 26/08): explica em 1-2 frases o que o numero significa e de
  // onde vem. Abre por toque (celular nao tem hover) e fecha ao tocar fora.
  info?: string;
  onClick?: () => void;
  className?: string;
}

const TONE: Record<KpiTone, string> = {
  default: 'text-slate-800',
  blue: 'text-blue-700',
  emerald: 'text-emerald-700',
  red: 'text-red-700',
  amber: 'text-amber-700',
  slate: 'text-slate-500',
};

// Icone ⓘ com balao. E um <span role="button"> (nao <button>) porque o card inteiro pode ser
// um <button> quando tem onClick — button dentro de button e HTML invalido.
function InfoHint({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [open]);
  return (
    <span ref={ref} className="relative shrink-0 inline-flex">
      <span
        role="button"
        tabIndex={0}
        aria-label="O que é isso?"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((v) => !v); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}
        className="w-4 h-4 rounded-full border border-slate-300 text-slate-400 hover:text-blue-600 hover:border-blue-400 text-[10px] leading-none font-serif italic flex items-center justify-center cursor-help select-none"
      >
        i
      </span>
      {open && (
        <span
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-5 z-30 w-56 sm:w-64 rounded-lg bg-slate-800 text-slate-50 text-xs font-normal normal-case tracking-normal leading-snug p-2.5 shadow-lg whitespace-normal"
        >
          {text}
        </span>
      )}
    </span>
  );
}

// Unifica as 6 variantes de KPI que existiam (Kpi x9, KpiCard accent, KpiCard subtext,
// KpiCard highlight, Card/CmpCard, SummaryChip): bg-white rounded shadow / label xs
// uppercase / valor bold. Mobile-first: text-xl em 375px, text-2xl a partir de sm.
export function KpiCard({ label, value, tone = 'default', sub, highlight, compact, badge, info, onClick, className = '' }: KpiCardProps): JSX.Element {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`bg-white rounded-lg shadow text-left min-w-0 ${compact ? 'p-3' : 'p-3 sm:p-4'} ${
        highlight ? 'border border-blue-200 ring-1 ring-blue-100' : ''
      } ${onClick ? 'hover:shadow-md transition cursor-pointer' : ''} ${className}`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="text-[11px] sm:text-xs uppercase tracking-wide text-slate-500 truncate">{label}</div>
        <div className="flex items-center gap-1 shrink-0">
          {badge}
          {info && <InfoHint text={info} />}
        </div>
      </div>
      <div className={`font-bold mt-1 break-words ${compact ? 'text-lg' : 'text-xl sm:text-2xl'} ${highlight ? 'text-blue-700' : TONE[tone]}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-slate-500 mt-0.5 truncate">{sub}</div>}
    </Tag>
  );
}

export type KpiCols = 2 | 3 | 4 | 5 | 6;

// Tailwind precisa das classes literais (nao monta `lg:grid-cols-${n}` em runtime).
const COLS: Record<KpiCols, string> = {
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
};

export interface KpiRowProps {
  cols?: KpiCols; // colunas em lg (desktop). Padrao = 4.
  children: ReactNode;
  className?: string;
}

// Grade de KPIs: SEMPRE 2 colunas no celular (nunca 1 — 3-4 cards empilhados de altura
// cheia empurravam o conteudo pra fora da tela em 9 paginas), 3 em sm, N em lg.
export function KpiRow({ cols = 4, children, className = '' }: KpiRowProps): JSX.Element {
  return <div className={`grid grid-cols-2 sm:grid-cols-3 ${COLS[cols]} gap-2 sm:gap-4 ${className}`}>{children}</div>;
}
