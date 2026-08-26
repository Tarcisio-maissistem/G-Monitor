import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string | undefined;
  // Filtros/botoes. No celular caem pra linha de baixo, ocupando a largura toda
  // (flex-wrap) — nao espremem o titulo como no header antigo das 21 paginas.
  actions?: ReactNode;
  className?: string;
}

// Cabecalho padrao de pagina: <h2> + subtitulo + acoes. Substitui o bloco
// `flex justify-between items-end gap-4 flex-wrap` repetido em todas as paginas.
export function PageHeader({ title, subtitle, actions, className = '' }: PageHeaderProps): JSX.Element {
  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="min-w-0">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 leading-tight">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 items-end sm:justify-end">{actions}</div>}
    </div>
  );
}

// Container padrao de pagina: p-3 no celular (24px de p-6 desperdicava 12% de 375px),
// p-6 a partir de sm. Unica pagina que ja fazia isso era o Dashboard.
export function PageContainer({ children, className = '' }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={`p-3 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-5 ${className}`}>{children}</div>;
}
