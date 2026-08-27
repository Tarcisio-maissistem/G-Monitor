// Paginação server-side (fonte única). Antes vivia dentro do ProdutosPage; extraída em 26/08
// pra A Pagar / A Receber usarem a mesma — as tabelas traziam 500 linhas de uma vez.
export function Pagination({
  page, totalPages, total, pageSize, onChange,
}: {
  page: number; totalPages: number; total: number; pageSize: number; onChange(p: number): void;
}): JSX.Element {
  return (
    <div className="border-t px-4 py-3 flex justify-between items-center text-sm">
      <div className="text-slate-500">
        {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} de {total.toLocaleString('pt-BR')}
      </div>
      <div className="flex gap-2 items-center">
        <button onClick={() => onChange(1)} disabled={page === 1} className="px-2 py-1 border rounded text-xs disabled:opacity-50 hover:bg-slate-50">⏮</button>
        <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page === 1} className="px-2 py-1 border rounded text-xs disabled:opacity-50 hover:bg-slate-50">←</button>
        <span className="text-slate-600">{page} / {totalPages}</span>
        <button onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="px-2 py-1 border rounded text-xs disabled:opacity-50 hover:bg-slate-50">→</button>
        <button onClick={() => onChange(totalPages)} disabled={page >= totalPages} className="px-2 py-1 border rounded text-xs disabled:opacity-50 hover:bg-slate-50">⏭</button>
      </div>
    </div>
  );
}
