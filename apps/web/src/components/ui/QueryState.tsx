import type { ReactNode } from 'react';
import { Spinner } from '../Spinner';

export function LoadingBox({ text = 'Carregando...', className = '' }: { text?: string; className?: string }): JSX.Element {
  return (
    <div className={`p-8 sm:p-12 text-center text-slate-400 text-sm flex items-center justify-center gap-2 ${className}`}>
      <Spinner className="h-3.5 w-3.5" /> {text}
    </div>
  );
}

// Erro de API VISIVEL. Em ~18 paginas `query.error` era ignorado e falha de rede virava
// "Sem dados no periodo" silencioso — criterio de pronto do D18: erro renderizado.
export function ErrorBox({ error, className = '' }: { error: unknown; className?: string }): JSX.Element {
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Erro ao carregar';
  return <div className={`text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg p-3 ${className}`}>⛔ {msg}</div>;
}

export function EmptyBox({ text = 'Sem dados no período.', className = '' }: { text?: string; className?: string }): JSX.Element {
  return <div className={`p-8 sm:p-12 text-center text-slate-400 text-sm ${className}`}>{text}</div>;
}

// Subconjunto do UseQueryResult que interessa — assim aceita qualquer query do TanStack
// sem amarrar o tipo generico do dado.
export interface QueryLike {
  isLoading: boolean;
  error: unknown;
}

export interface QueryStateProps {
  query: QueryLike;
  // true (ou texto) quando a query voltou vazia — quem sabe o que e "vazio" e a pagina
  // (rows.length === 0, quantity === 0...). String customiza a mensagem.
  empty?: boolean | string | undefined;
  loadingText?: string;
  children: ReactNode;
  className?: string;
}

// Spinner -> ErrorBox -> EmptyBox -> children, nessa ordem. Uma unica forma de tratar
// os 3 estados em vez de cada pagina inventar a sua.
export function QueryState({ query, empty, loadingText, children, className = '' }: QueryStateProps): JSX.Element {
  if (query.isLoading) return <LoadingBox {...(loadingText ? { text: loadingText } : {})} className={className} />;
  if (query.error) return <ErrorBox error={query.error} className={className} />;
  if (empty) return <EmptyBox {...(typeof empty === 'string' ? { text: empty } : {})} className={className} />;
  return <>{children}</>;
}
