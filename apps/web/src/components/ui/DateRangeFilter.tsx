import type { ReactNode } from 'react';
import { PERIOD_PRESETS, matchPreset, type DateRange, type PeriodPresetKey } from '../../lib/period';

export interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  // Chips de atalho. true = todos (Hoje / 7 dias / Mes atual / Mes anterior); lista = subconjunto;
  // false = so os 2 inputs.
  presets?: boolean | PeriodPresetKey[];
  labels?: { from?: string; to?: string }; // "Vencimento de" / "Ate" nas paginas de titulos
  children?: ReactNode; // acoes ao lado dos inputs (Excel, WhatsApp) — entram no mesmo flex-wrap
  className?: string;
}

// Filtro De/Ate compartilhado (base: DateFilter de RelatoriosPage, que era render-prop com
// estado proprio). Aqui e CONTROLADO: a pagina guarda o range (useState(currentMonthRange()))
// e passa pra querystring — assim o default segue a regra do dono (mes atual) num lugar so.
// Mobile-first: inputs com flex-1 min-w cabem os 2 lado a lado em 375px; chips em linha
// propria com wrap.
export function DateRangeFilter({ value, onChange, presets = true, labels, children, className = '' }: DateRangeFilterProps): JSX.Element {
  const chips = presets === false ? [] : presets === true ? PERIOD_PRESETS : PERIOD_PRESETS.filter((p) => presets.includes(p.key));
  const active = chips.length > 0 ? matchPreset(value) : null;

  return (
    <div className={`flex flex-col gap-2 w-full sm:w-auto ${className}`}>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex-1 min-w-[8.5rem] sm:flex-none">
          <span className="block text-xs uppercase text-slate-500 mb-1">{labels?.from ?? 'De'}</span>
          <input
            type="date"
            value={value.from}
            max={value.to || undefined}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            className="w-full border rounded px-2 py-1 text-sm bg-white"
          />
        </label>
        <label className="flex-1 min-w-[8.5rem] sm:flex-none">
          <span className="block text-xs uppercase text-slate-500 mb-1">{labels?.to ?? 'Até'}</span>
          <input
            type="date"
            value={value.to}
            min={value.from || undefined}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            className="w-full border rounded px-2 py-1 text-sm bg-white"
          />
        </label>
        {children}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(p.range())}
              className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap ${
                active === p.key ? 'bg-blue-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
