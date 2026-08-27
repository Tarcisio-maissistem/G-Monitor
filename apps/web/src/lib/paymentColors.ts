// Cor e rótulo por FORMA canônica de pagamento (dinheiro/pix/cartao/crediario/outros).
// Fonte única pro Dashboard (lista + pizza) e qualquer tela que mostre formas — assim a cor
// segue a forma, nunca o rank (regra de dataviz). Palette validada pelo validate_palette.js
// do skill dataviz: aqua/azul/violeta/laranja passam todos os checks no claro; no escuro o par
// azul↔violeta é o único justo, coberto porque toda barra/fatia leva o NOME direto (identidade
// é textual, não só cor). "outros" é o neutro cinza (catch-all), como manda o guia.
export type PaymentKind = 'dinheiro' | 'pix' | 'cartao' | 'crediario' | 'outros';

interface PayStyle { label: string; color: string; colorDark: string }

export const PAYMENT_STYLE: Record<string, PayStyle> = {
  dinheiro: { label: 'Dinheiro', color: '#1baf7a', colorDark: '#199e70' }, // aqua = dinheiro
  pix: { label: 'PIX', color: '#2a78d6', colorDark: '#3987e5' }, // azul
  cartao: { label: 'Cartão', color: '#eb6834', colorDark: '#d95926' }, // laranja
  crediario: { label: 'Crediário / A Prazo', color: '#6d4aa7', colorDark: '#9085e9' }, // violeta
  outros: { label: 'Outros', color: '#94a3b8', colorDark: '#94a3b8' }, // cinza neutro
};

// Ordem fixa de exibição (identidade estável — não reordena por valor, senão a cor "salta"
// entre formas quando o mês muda).
export const PAYMENT_ORDER: PaymentKind[] = ['dinheiro', 'pix', 'cartao', 'crediario', 'outros'];

export function payStyle(kind: string): PayStyle {
  return PAYMENT_STYLE[kind] ?? PAYMENT_STYLE.outros;
}
