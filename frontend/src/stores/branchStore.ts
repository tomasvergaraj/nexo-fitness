import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface BranchState {
  selectedBranchId: number | null;
  setSelectedBranchId: (id: number | null) => void;
  clear: () => void;
}

export const useBranchStore = create<BranchState>()(
  persist(
    (set) => ({
      selectedBranchId: null,
      setSelectedBranchId: (id) => set({ selectedBranchId: id }),
      clear: () => set({ selectedBranchId: null }),
    }),
    { name: 'nexo-branch' },
  ),
);
