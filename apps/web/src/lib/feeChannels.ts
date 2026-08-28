import type { FeeChannel } from './reports';

// Rótulo e cor por canal de taxa. Reaproveita a paleta de formas de pagamento (cartão laranja,
// PIX azul) pra tela não inventar uma 3a linguagem de cor. Ver lib/paymentColors.
// TEF = maquininha integrada ao PDV; "avulsa" = a outra maquininha (na J.Kastros, a da
// entrega). São adquirentes diferentes, com taxas diferentes — por isso campos separados.
export const FEE_CHANNEL_LABEL: Record<FeeChannel, string> = {
  tef_debito: 'Cartão débito — TEF (integrada)',
  tef_credito: 'Cartão crédito — TEF (integrada)',
  pos_debito: 'Cartão débito — maquininha avulsa',
  pos_credito: 'Cartão crédito — maquininha avulsa',
  pix_tef: 'PIX pelo TEF (Shipay)',
  pix_estatico: 'PIX estático (QR fixo)',
};

export const FEE_CHANNEL_COLOR: Record<FeeChannel, string> = {
  tef_debito: '#eb6834',
  tef_credito: '#c9541f',
  pos_debito: '#f0a06b',
  pos_credito: '#a8410f',
  pix_tef: '#2a78d6',
  pix_estatico: '#1baf7a',
};

export const FEE_CHANNELS: FeeChannel[] = ['tef_debito', 'tef_credito', 'pos_debito', 'pos_credito', 'pix_tef', 'pix_estatico'];
