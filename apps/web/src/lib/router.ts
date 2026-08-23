import { useEffect, useState } from 'react';

// Roteador minimalista baseado em hash.
// Sem dependencias externas; suficiente pro escopo atual.

export function useRoute(): {
  path: string;
  navigate(to: string): void;
  params: Record<string, string>;
} {
  const [path, setPath] = useState(() => window.location.hash.slice(1) || '/');

  useEffect(() => {
    const onChange = (): void => setPath(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = (to: string): void => {
    window.location.hash = to;
  };

  return { path, navigate, params: {} };
}

// Combina parts no formato '/empresas/:tenantId/lojas/:storeId'.
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i]!;
    const v = pathParts[i]!;
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(v);
    } else if (p !== v) {
      return null;
    }
  }
  return params;
}
