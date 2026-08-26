// Periodos de relatorio (from/to em 'YYYY-MM-DD') — fonte unica pro filtro de datas.
// Regra do dono (23/08): periodo padrao = MES ATUAL, do dia 1 ate hoje (nao "ultimos 30 dias").
//
// Todas as datas sao montadas a partir dos componentes LOCAIS (getFullYear/getMonth/getDate).
// `toISOString().slice(0,10)` (usado nas paginas antigas) devolve o dia em UTC: as 21h
// no Brasil ja e "amanha" em UTC e o filtro pulava um dia. O backend recebe so a data e
// agrupa por dia em UTC (03:00Z = DATE do GDOOR), entao a data local e a certa aqui.

export interface DateRange {
  from: string; // 'YYYY-MM-DD'
  to: string; // 'YYYY-MM-DD'
}

export type PeriodPresetKey = 'hoje' | '7dias' | 'mes' | 'mesAnterior';

export interface PeriodPreset {
  key: PeriodPresetKey;
  label: string;
  range: (now?: Date) => DateRange;
}

// Date local -> 'YYYY-MM-DD' (sem passar por UTC).
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayIso(now: Date = new Date()): string {
  return isoDate(now);
}

// Dia 1 do mes corrente ate hoje.
export function currentMonthRange(now: Date = new Date()): DateRange {
  return { from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDate(now) };
}

// Mes anterior inteiro (dia 1 ate o ultimo dia).
export function previousMonthRange(now: Date = new Date()): DateRange {
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0); // dia 0 = ultimo dia do mes anterior
  return { from: isoDate(first), to: isoDate(last) };
}

// Ultimos N dias INCLUINDO hoje (7 dias = hoje + 6 anteriores).
export function lastNDaysRange(n: number, now: Date = new Date()): DateRange {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1));
  return { from: isoDate(from), to: isoDate(now) };
}

export function todayRange(now: Date = new Date()): DateRange {
  const d = isoDate(now);
  return { from: d, to: d };
}

// Mes/ano -> intervalo do mes inteiro (paginas com select ano/mes: Fechamento, MetaMensal).
export function monthRange(year: number, month: number): DateRange {
  return { from: isoDate(new Date(year, month - 1, 1)), to: isoDate(new Date(year, month, 0)) };
}

// Presets dos chips do DateRangeFilter, na ordem em que aparecem na tela.
export const PERIOD_PRESETS: readonly PeriodPreset[] = [
  { key: 'hoje', label: 'Hoje', range: todayRange },
  { key: '7dias', label: '7 dias', range: (now) => lastNDaysRange(7, now) },
  { key: 'mes', label: 'Mês atual', range: currentMonthRange },
  { key: 'mesAnterior', label: 'Mês anterior', range: previousMonthRange },
];

export function presetRange(key: PeriodPresetKey, now: Date = new Date()): DateRange {
  const p = PERIOD_PRESETS.find((x) => x.key === key);
  return p ? p.range(now) : currentMonthRange(now);
}

// Qual preset bate exatamente com o range atual (pra destacar o chip). null = periodo customizado.
export function matchPreset(range: DateRange, now: Date = new Date()): PeriodPresetKey | null {
  for (const p of PERIOD_PRESETS) {
    const r = p.range(now);
    if (r.from === range.from && r.to === range.to) return p.key;
  }
  return null;
}

// Numero de dias cobertos pelo range (inclusivo). Usado pra decidir granularidade (>31 = semana).
export function daysInRange(range: DateRange): number {
  const a = Date.UTC(...splitIso(range.from));
  const b = Date.UTC(...splitIso(range.to));
  return Math.floor((b - a) / 86_400_000) + 1;
}

// Rotulo curto pra titulo/WhatsApp: "01/08 a 25/08/2026" (mesmo ano) ou "15/12/2025 a 10/01/2026".
export function periodLabel(range: DateRange): string {
  const [fy, fm, fd] = splitIso(range.from);
  const [ty, tm, td] = splitIso(range.to);
  const dd = (d: number) => String(d).padStart(2, '0');
  const fromStr = fy === ty ? `${dd(fd)}/${dd(fm + 1)}` : `${dd(fd)}/${dd(fm + 1)}/${fy}`;
  return `${fromStr} a ${dd(td)}/${dd(tm + 1)}/${ty}`;
}

// Nome do mes por extenso ("agosto de 2026") pra titulos de resumo mensal.
export function monthLabel(now: Date = new Date()): string {
  return now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

// 'YYYY-MM-DD' -> [ano, mesIndex0, dia]
function splitIso(s: string): [number, number, number] {
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10));
  return [y ?? 1970, (m ?? 1) - 1, d ?? 1];
}

// Querystring padrao dos endpoints de relatorio (from&to[&storeId]).
export function rangeQuery(range: DateRange, extra: Record<string, string | number | undefined> = {}): string {
  const qs = new URLSearchParams({ from: range.from, to: range.to });
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') qs.set(k, String(v));
  return qs.toString();
}
