import { create } from 'zustand';
import type { HealthInfo } from '@shared/api';
import { getHealth } from './api';

export type Availability = 'checking' | 'live' | 'unconfigured' | 'offline' | 'preview';

interface HealthStore {
  state: Availability;
  info: HealthInfo | null;
  check: () => Promise<void>;
}

export const useHealth = create<HealthStore>((set) => ({
  state: __PREVIEW__ ? 'preview' : 'checking',
  info: null,
  async check() {
    if (__PREVIEW__) return set({ state: 'preview', info: null });
    try {
      const info = await getHealth(AbortSignal.timeout(6000));
      set({ info, state: info.mode === 'live' ? 'live' : 'unconfigured' });
    } catch {
      set({ state: 'offline', info: null });
    }
  },
}));

export const AVAILABILITY_TEXT: Record<Availability, { short: string; long: string }> = {
  checking: { short: 'Connecting', long: 'Connecting to I SEE…' },
  live: { short: 'Live', long: 'Connected. You can examine your own photos.' },
  unconfigured: { short: 'Examples only', long: 'Scanning your own photos is not switched on yet, so for now you can explore the examples.' },
  offline: { short: 'Examples only', long: 'I SEE is offline right now, so for now you can explore the examples. Check your internet connection and refresh to try again.' },
  preview: { short: 'Preview', long: 'This is the stand-alone preview: examples only, nothing is sent anywhere.' },
};
