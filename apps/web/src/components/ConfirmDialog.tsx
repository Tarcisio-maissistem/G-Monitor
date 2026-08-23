import { create } from 'zustand';

interface ConfirmConfig {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

interface ConfirmStore {
  config: ConfirmConfig | null;
  busy: boolean;
  ask(config: ConfirmConfig): void;
  close(): void;
  setBusy(busy: boolean): void;
}

export const useConfirm = create<ConfirmStore>((set) => ({
  config: null,
  busy: false,
  ask(config) {
    set({ config, busy: false });
  },
  close() {
    set({ config: null, busy: false });
  },
  setBusy(busy) {
    set({ busy });
  },
}));

export function ConfirmDialog(): JSX.Element | null {
  const config = useConfirm((s) => s.config);
  const busy = useConfirm((s) => s.busy);
  const close = useConfirm((s) => s.close);
  const setBusy = useConfirm((s) => s.setBusy);

  if (!config) return null;

  const handleConfirm = async (): Promise<void> => {
    setBusy(true);
    try {
      await config.onConfirm();
      close();
    } catch {
      // erros sao mostrados via toast pelo chamador
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[90]">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-bold mb-2">{config.title}</h3>
        <p className="text-sm text-slate-600">{config.message}</p>
        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={close}
            disabled={busy}
            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded disabled:opacity-50"
          >
            {config.cancelLabel ?? 'Cancelar'}
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            className={`px-4 py-2 text-sm text-white rounded disabled:opacity-50 ${
              config.destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {busy ? 'Aguarde...' : config.confirmLabel ?? 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
