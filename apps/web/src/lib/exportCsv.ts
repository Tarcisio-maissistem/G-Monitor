// Exportação CSV compatível com Excel (BOM + separador ; + decimal vírgula)
// Por que não xlsx: bibliotecas pesadas (~500KB). CSV abre direto no Excel com configuração regional BR.

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  // Quando true, formata como número com vírgula decimal
  number?: boolean;
  // Quando true, formata como moeda (sem prefixo R$, só o número)
  money?: boolean;
}

export function exportToCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]): void {
  const sep = ';';
  const header = columns.map((c) => escape(c.header)).join(sep);
  const lines = rows.map((row) =>
    columns
      .map((c) => {
        const raw = c.value(row);
        if (raw == null) return '';
        if (typeof raw === 'number') {
          if (c.money) return raw.toFixed(2).replace('.', ',');
          if (c.number) return raw.toString().replace('.', ',');
          return raw.toString();
        }
        return escape(String(raw));
      })
      .join(sep),
  );

  // BOM (﻿) faz o Excel reconhecer UTF-8 corretamente
  const csv = '﻿' + [header, ...lines].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escape(v: string): string {
  if (v.includes('"') || v.includes(';') || v.includes('\n') || v.includes('\r')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function todayStamp(): string {
  const d = new Date();
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
