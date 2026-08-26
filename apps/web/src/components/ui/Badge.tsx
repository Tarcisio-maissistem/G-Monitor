import type { ReactNode } from 'react';
import type { DataStatus } from '../../lib/reports';

export type BadgeTone = 'blue' | 'emerald' | 'red' | 'amber' | 'orange' | 'purple' | 'slate';

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  pill?: boolean; // rounded-full (chip de filtro) em vez de rounded
  size?: 'xs' | 'sm';
  title?: string | undefined;
  className?: string;
}

const TONE: Record<BadgeTone, string> = {
  blue: 'bg-blue-100 text-blue-800',
  emerald: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-800',
  orange: 'bg-orange-100 text-orange-800',
  purple: 'bg-purple-100 text-purple-800',
  slate: 'bg-slate-100 text-slate-700',
};

// Selo generico. Cobre os 9 mapas status->classe que existiam (StatusBadge de
// ContasPagar/Receber/Empresas, KlassBadge, SIT_COLOR, SEVERITY_COLOR, PRIORITY_COLOR...).
export function Badge({ tone = 'slate', children, pill, size = 'xs', title, className = '' }: BadgeProps): JSX.Element {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap font-medium ${pill ? 'rounded-full' : 'rounded'} ${
        size === 'xs' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'
      } ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// Selo de honestidade do dado (P3): real / estimativa / N/D. Texto e cor fixos por status
// pra ser reconhecivel em toda tela (DRE, KPI do fluxo, banner).
export const DATA_STATUS_LABEL: Record<DataStatus, string> = { real: 'real', estimate: 'estimativa', nd: 'N/D' };
const DATA_STATUS_TONE: Record<DataStatus, BadgeTone> = { real: 'emerald', estimate: 'amber', nd: 'slate' };
const DATA_STATUS_TITLE: Record<DataStatus, string> = {
  real: 'Dado sincronizado do GDOOR',
  estimate: 'Aproximacao — parte do dado ainda nao e sincronizada',
  nd: 'Nao disponivel — o agente ainda nao sincroniza essa informacao',
};

export function DataStatusBadge({ status, note, className = '' }: { status: DataStatus; note?: string | null | undefined; className?: string }): JSX.Element {
  return (
    <Badge tone={DATA_STATUS_TONE[status]} title={note ?? DATA_STATUS_TITLE[status]} className={className}>
      {DATA_STATUS_LABEL[status]}
    </Badge>
  );
}

// Chip de filtro (todos / a pagar / pago...): rounded-full, azul quando ativo.
export function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-3 py-1 rounded-full whitespace-nowrap ${active ? 'bg-blue-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
    >
      {children}
    </button>
  );
}
