import type { FeeChannel } from './reports';

// Rótulo e cor por canal de taxa. Reaproveita a paleta de formas de pagamento (cartão laranja,
// PIX azul) pra tela não inventar uma 3a linguagem de cor. Ver lib/paymentColors.
export const FEE_CHANNEL_LABEL: Record<FeeChannel, string> = {
  pos_debito: 'Cartão débito (POS)',
  pos_credito: 'Cartão crédito (POS)',
  pix_tef: 'PIX pelo TEF (Shipay)',
  pix_estatico: 'PIX estático (QR fixo)',
};

export const FEE_CHANNEL_COLOR: Record<FeeChannel, string> = {
  pos_debito: '#eb6834',
  pos_credito: '#c9541f',
  pix_tef: '#2a78d6',
  pix_estatico: '#1baf7a',
};

export const FEE_CHANNELS: FeeChannel[] = ['pos_debito', 'pos_credito', 'pix_tef', 'pix_estatico'];
