import { useState } from 'react';
import { copyToClipboard } from '../../lib/clipboard';
import { useToast } from '../Toast';
import { Spinner } from '../Spinner';

export interface CopyWhatsAppButtonProps {
  // Texto pronto OU funcao que monta na hora (buildWhatsAppResumo de lib/whatsapp) — a
  // funcao evita montar string a cada render da pagina.
  text: string | (() => string);
  disabled?: boolean | undefined; // ex: !query.data
  label?: string;
  className?: string;
}

// Botao "Copiar p/ WhatsApp" que existia em Dashboard/ContasPagar/ContasReceber (3 copias
// identicas): copia + toast de sucesso/erro. No celular mostra so o icone + "WhatsApp".
export function CopyWhatsAppButton({ text, disabled, label = 'Copiar p/ WhatsApp', className = '' }: CopyWhatsAppButtonProps): JSX.Element {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const handle = async (): Promise<void> => {
    setBusy(true);
    try {
      const value = typeof text === 'function' ? text() : text;
      const ok = await copyToClipboard(value);
      toast.push(ok ? { type: 'success', message: 'Resumo copiado — cole no WhatsApp.' } : { type: 'error', message: 'Não consegui copiar. Tente selecionar o texto manualmente.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handle()}
      disabled={disabled || busy}
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed h-fit whitespace-nowrap ${className}`}
      title="Copiar resumo formatado pra colar no WhatsApp"
    >
      {busy ? <Spinner className="h-3 w-3" /> : <span>📋</span>}
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">WhatsApp</span>
    </button>
  );
}
