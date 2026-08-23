import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface Tenant {
  id: string;
  name: string;
}

interface TenantState {
  selectedTenantId: string | null;
  selectedTenantName: string | null;
  setSelected(t: Tenant | null): void;
  clear(): void;
}

export const useTenantStore = create<TenantState>()(
  persist(
    (set) => ({
      selectedTenantId: null,
      selectedTenantName: null,
      setSelected(t) {
        if (t) set({ selectedTenantId: t.id, selectedTenantName: t.name });
        else set({ selectedTenantId: null, selectedTenantName: null });
      },
      clear() {
        set({ selectedTenantId: null, selectedTenantName: null });
      },
    }),
    { name: 'gmonitor-tenant', storage: createJSONStorage(() => localStorage) },
  ),
);
