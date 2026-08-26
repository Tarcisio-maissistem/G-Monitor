import type { ReactNode } from 'react';

export interface CardListColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string; // classes extras da celula (ex: 'font-mono text-xs', 'max-w-xs truncate')
  headerClassName?: string;
}

export interface CardListProps<T> {
  rows: T[];
  columns: CardListColumn<T>[];
  // Card do celular: a pagina decide o que cabe (titulo, subtitulo, valor, badge).
  renderCard: (row: T, index: number) => ReactNode;
  keyOf: (row: T, index: number) => string;
  onRowTap?: ((row: T) => void) | undefined; // drill-down (card e linha viram clicaveis)
  // Rodape (tfoot) por coluna, so na tabela. No celular, passe um KpiRow acima — tfoot
  // nao tem lugar num card.
  totals?: Partial<Record<string, ReactNode>> | undefined;
  className?: string;
  cardClassName?: string;
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

// Lista responsiva (padrao extraido de ContasPagarPage l.121-170): cards `sm:hidden divide-y`
// no celular + tabela `hidden sm:block overflow-x-auto` a partir de 640px. Os dois ficam
// montados (CSS esconde um) — mesma estrategia da pagina original, sem media query em JS.
// Estados (loading/erro/vazio) ficam FORA, no QueryState: aqui so chega lista com dados.
export function CardList<T>({ rows, columns, renderCard, keyOf, onRowTap, totals, className = '', cardClassName = '' }: CardListProps<T>): JSX.Element {
  const tappable = Boolean(onRowTap);
  return (
    <div className={`bg-white rounded-lg shadow overflow-hidden ${className}`}>
      {/* Celular: 7 colunas de tabela nao cabem em ~390px sem cortar Valor/Status */}
      <div className="sm:hidden divide-y">
        {rows.map((row, i) =>
          tappable ? (
            <button
              key={keyOf(row, i)}
              type="button"
              onClick={() => onRowTap?.(row)}
              className={`w-full text-left p-3 space-y-1 active:bg-slate-50 hover:bg-slate-50 ${cardClassName}`}
            >
              {renderCard(row, i)}
            </button>
          ) : (
            <div key={keyOf(row, i)} className={`p-3 space-y-1 ${cardClassName}`}>
              {renderCard(row, i)}
            </div>
          ),
        )}
      </div>

      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`px-3 py-2 ${ALIGN[c.align ?? 'left']} ${c.headerClassName ?? ''}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={keyOf(row, i)}
                onClick={tappable ? () => onRowTap?.(row) : undefined}
                className={`border-t hover:bg-slate-50 ${tappable ? 'cursor-pointer' : ''}`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 ${ALIGN[c.align ?? 'left']} ${c.className ?? ''}`}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {totals && (
            <tfoot className="bg-slate-50 font-semibold border-t">
              <tr>
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 ${ALIGN[c.align ?? 'left']}`}>
                    {totals[c.key] ?? null}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// Blocos prontos pro renderCard — a pagina compoe: <CardRow title sub right={<Badge/>} />
// + <CardMeta left="25/08 · #123" right={formatBRL(v)} />. Sao os mesmos 2-3 niveis do
// card de ContasPagar, so que nomeados.
export function CardRow({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="font-medium text-slate-800 truncate">{title}</div>
        {sub && <div className="text-xs text-slate-500 truncate">{sub}</div>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function CardMeta({ left, right, muted }: { left?: ReactNode; right?: ReactNode; muted?: boolean }): JSX.Element {
  return (
    <div className={`flex items-center justify-between gap-2 ${muted ? 'text-xs text-slate-500' : 'text-sm'}`}>
      <span className="text-slate-500 truncate">{left}</span>
      <span className={muted ? '' : 'font-medium'}>{right}</span>
    </div>
  );
}
