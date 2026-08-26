// Tema do app (26/08). Escuro e o PADRAO (pedido do dono); claro e creme. A escolha fica
// em localStorage e e aplicada como data-theme no <html> — o CSS (styles.css) faz o resto.
export type Theme = 'dark' | 'light';
const KEY = 'gm-theme';

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' ? 'light' : 'dark'; // default e sempre dark
  } catch {
    return 'dark';
  }
}

export function applyTheme(t: Theme): void {
  document.documentElement.setAttribute('data-theme', t);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* modo anonimo / storage bloqueado: aplica sem persistir */
  }
}

// Chamado no boot (main.tsx) ANTES do React montar, pra nao piscar branco.
export function initTheme(): void {
  document.documentElement.setAttribute('data-theme', getTheme());
}
