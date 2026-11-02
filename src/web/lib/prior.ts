import { create } from 'zustand';
import type { ProfileDigest } from '@shared/schema';

/** A follow-up scan carries what is already known, so the new photo refines it instead of starting over. */
export const usePrior = create<{ prior: ProfileDigest | null; instruction: string | null; set: (p: ProfileDigest | null, instruction?: string | null) => void }>((set) => ({
  prior: null,
  instruction: null,
  set: (prior, instruction = null) => set({ prior, instruction }),
}));
