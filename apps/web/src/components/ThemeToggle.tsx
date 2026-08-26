import { useState } from 'react';
import { getTheme, applyTheme, type Theme } from '../lib/theme';

// Alterna escuro/claro (creme). Escuro e o padrao. Sol = esta no escuro, pode clarear;
// Lua = esta no claro, pode escurecer.
export function ThemeToggle({ className = '' }: { className?: string }): JSX.Element {
  const [theme, setTheme] = useState<Theme>(() => getTheme());
  const toggle = (): void => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };
  return (
    <button
      onClick={toggle}
      className={`rounded-lg p-2 hover:bg-slate-800 text-slate-300 leading-none ${className}`}
      aria-label={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      title={theme === 'dark' ? 'Tema claro (creme)' : 'Tema escuro'}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
