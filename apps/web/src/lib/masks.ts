// Mascaras de entrada e formatadores reutilizaveis.
// Cada `applyXxx(value)` recebe a string atual do input e retorna ja formatada.
// Os `parseXxx(value)` extraem o valor cru (sem mascara) pra mandar ao backend.

// ============ MOEDA (BRL) ============
// Funciona acumulando dígitos da direita pra esquerda como caixa eletrônico.
// Ex: digito "1" -> "0,01", "12" -> "0,12", "123" -> "1,23", "12345" -> "123,45"
export function applyCurrency(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  const num = parseInt(digits, 10);
  const cents = num / 100;
  return cents.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Recebe "1.234,56" e retorna 1234.56 (Number)
export function parseCurrency(masked: string): number {
  if (!masked) return 0;
  const digits = masked.replace(/\D/g, '');
  if (!digits) return 0;
  return parseInt(digits, 10) / 100;
}

// Formata um número como BRL (R$ 1.234,56). FONTE UNICA — as 26 copias locais nas
// paginas/componentes devem importar daqui (D18 do fluxo-caixa-dre).
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export function formatBRL(n: number | null | undefined): string {
  return BRL.format(n ?? 0);
}

// Versao curta pra caber em celula/KPI estreito no celular (ex: "R$ 1,2 mil", "R$ 348 mil").
// Movida de FinanceCalendar.tsx (era local) pra servir KpiCard compact e o calendario.
const BRL_COMPACT = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
export function formatCompactBRL(n: number | null | undefined): string {
  return BRL_COMPACT.format(n ?? 0);
}

// Percentual ja em escala 0-100 (ex: 12.345 -> "12,3%"). null vira "—" (DRE usa pct:null
// quando o denominador e zero — nunca mostrar "0%" escondendo divisao por zero).
export function formatPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

// ============ PORCENTAGEM ============
// Aceita até 2 casas decimais (ex: 12,5 ou 100,00)
export function applyPercent(value: string): string {
  // Permite apenas digitos e uma virgula/ponto
  const cleaned = value.replace(/[^\d.,]/g, '').replace('.', ',');
  // Garante apenas uma virgula
  const parts = cleaned.split(',');
  if (parts.length > 2) return parts[0] + ',' + parts.slice(1).join('').slice(0, 2);
  if (parts[1] != null) parts[1] = parts[1].slice(0, 2);
  let num = parts.join(',');
  // Limita parte inteira a 3 digitos (max 100,00)
  if (parts[0] && parts[0].length > 3) {
    num = parts[0].slice(0, 3) + (parts[1] != null ? ',' + parts[1] : '');
  }
  return num;
}

export function parsePercent(masked: string): number {
  if (!masked) return 0;
  const n = parseFloat(masked.replace(',', '.'));
  return isNaN(n) ? 0 : Math.min(100, Math.max(0, n));
}

// ============ CPF ============
// 000.000.000-00
export function applyCpf(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

// ============ CNPJ ============
// 00.000.000/0000-00
export function applyCnpj(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  return digits
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
    .replace(/(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5');
}

// Detecta CPF (11 digitos) ou CNPJ (14 digitos) e aplica a mascara correta
export function applyCpfOrCnpj(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 11) return applyCpf(value);
  return applyCnpj(value);
}

// Remove a mascara (so digitos) — bom pra enviar ao backend
export function parseDigits(masked: string): string {
  return (masked ?? '').replace(/\D/g, '');
}

// ============ TELEFONE BR ============
// (11) 99999-9999 ou (11) 3333-4444
export function applyPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 10) {
    // (11) 3333-4444
    return digits
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  }
  // Celular: (11) 99999-9999
  return digits
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d)/, '$1-$2');
}

// ============ CEP ============
// 00000-000
export function applyCep(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return digits.replace(/(\d{5})(\d)/, '$1-$2');
}

// ============ DATA DD/MM/AAAA ============
export function applyDate(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return digits
    .replace(/(\d{2})(\d)/, '$1/$2')
    .replace(/(\d{2})\/(\d{2})(\d)/, '$1/$2/$3');
}

// "19/05/2026" -> Date | null
export function parseBrDate(masked: string): Date | null {
  const m = (masked ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(parseInt(m[3]!, 10), parseInt(m[2]!, 10) - 1, parseInt(m[1]!, 10));
  if (isNaN(d.getTime())) return null;
  return d;
}

// Date | ISO -> "19/05/2026".
// String so-data ("2026-05-19", como o `dia` do /cashflow) e formatada em UTC de proposito:
// `new Date('2026-05-19')` e meia-noite UTC, que no fuso do Brasil (UTC-3) vira 18/05 —
// bug classico de "dia anterior". Datetime completo (03:00Z do GDOOR) segue no fuso local.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export function formatBrDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  if (typeof d === 'string' && DATE_ONLY.test(d)) {
    return new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  }
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR');
}

// Date | ISO -> "19/05" (eixo de grafico e card estreito; mesma regra de so-data acima).
export function formatBrDayMonth(d: Date | string | null | undefined): string {
  if (!d) return '';
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit' };
  if (typeof d === 'string' && DATE_ONLY.test(d)) {
    return new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR', { ...opts, timeZone: 'UTC' });
  }
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR', opts);
}

// Date -> "19/05/2026 14:30"
export function formatBrDateTime(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '';
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ============ NUMERO INTEIRO ============
// Formata milhares: 1234567 -> "1.234.567"
export function formatInt(n: number | null | undefined): string {
  if (n == null) return '';
  return n.toLocaleString('pt-BR');
}

// Mascara de input com separador de milhares (só inteiros)
export function applyInteger(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  return parseInt(digits, 10).toLocaleString('pt-BR');
}

export function parseInteger(masked: string): number {
  const digits = (masked ?? '').replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : 0;
}
