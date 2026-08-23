import { create } from 'zustand';
import { useEffect } from 'react';

interface ToastItem {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface ToastStore {
  items: ToastItem[];
  push(item: Omit<ToastItem, 'id'>): void;
  remove(id: number): void;
}

let nextId = 1;

export const useToast = create<ToastStore>((set) => ({
  items: [],
  push(item) {
    const id = nextId++;
    set((s) => ({ items: [...s.items, { ...item, id }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), 4000);
  },
  remove(id) {
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
  },
}));

export function ToastContainer(): JSX.Element {
  const items = useToast((s) => s.items);
  const remove = useToast((s) => s.remove);

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 max-w-sm">
      {items.map((t) => (
        <Toast key={t.id} item={t} onClose={() => remove(t.id)} />
      ))}
    </div>
  );
}

function Toast({ item, onClose }: { item: ToastItem; onClose(): void }): JSX.Element {
  const colors: Record<ToastItem['type'], string> = {
    success: 'bg-emerald-600 text-white',
    error: 'bg-red-600 text-white',
    info: 'bg-slate-700 text-white',
  };
  useEffect(() => {
    // anim mount
  }, []);
  return (
    <div className={`${colors[item.type]} px-4 py-3 rounded shadow-lg text-sm flex items-start gap-3 animate-slideIn`}>
      <span className="flex-1">{item.message}</span>
      <button onClick={onClose} className="text-white/80 hover:text-white">
        ✕
      </button>
    </div>
  );
}
