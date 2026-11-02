/**
 * One scan at a time: live (through the gateway) or sample (in the browser, no model
 * called). Both paths produce the same ScanEvents, so the darkroom cannot tell them
 * apart except by the label it is required to show.
 */
import { taughtForScan } from './teach';
import { create } from 'zustand';
import type { EscalationRequest, ScanEvent, ScanRequest } from '@shared/api';
import { STAGE_IDS, type Candidate, type Profile, type ProfileDigest, type QualityReport, type Region, type Source, type StageId } from '@shared/schema';
import { runScan, STAGE_LABEL } from '@shared/orchestrator';
import { sampleRetriever, sampleTasks } from '@fixtures/samples/tasks';
import { answerEscalation, cancelJob, followJob, friendlyMessage, startScan, userMessage } from './api';
import { putEntry } from './passport';
import { recordedById, sampleById } from './samples';
import { prefersReducedMotion, useSettings } from './settings';
import { useHealth } from './health';
import type { PreparedImage } from './images';
import { urlToBlob } from './images';

export interface StageView {
  id: StageId;
  label: string;
  status: 'pending' | 'running' | 'done' | 'skip' | 'error';
  model: string | null;
  provider: string | null;
  ms: number | null;
  note: string | null;
  startedAt: number | null;
}

export interface RunStore {
  status: 'idle' | 'running' | 'done' | 'error' | 'cancelled';
  mode: 'live' | 'sample' | 'recorded';
  sampleId: string | null;
  photoUrls: string[];
  dims: Array<{ width: number; height: number }>;
  stages: Record<StageId, StageView>;
  quality: QualityReport | null;
  candidates: Candidate[];
  identity: 'identified' | 'candidates' | 'unknown' | null;
  regions: Region[];
  sources: Source[];
  profile: Profile | null;
  error: { message: string; retryable: boolean } | null;
  escalation: EscalationRequest | null;
  jobId: string | null;
  log: Array<{ t: number; text: string }>;
  startSample: (id: string) => Promise<void>;
  /** Opens any example: a recorded run is replayed, a built-in sample is run in the browser. */
  startExample: (id: string) => Promise<void>;
  startLive: (images: PreparedImage[], hint: string | null, prior?: ProfileDigest | null) => Promise<void>;
  cancel: () => void;
  answerEscalation: (approve: boolean) => void;
  reset: () => void;
}

const freshStages = (): Record<StageId, StageView> =>
  Object.fromEntries(STAGE_IDS.map((id) => [id, { id, label: STAGE_LABEL[id], status: 'pending', model: null, provider: null, ms: null, note: null, startedAt: null }])) as Record<StageId, StageView>;

let abort: AbortController | null = null;
let stopFollow: (() => void) | null = null;
let escalationResolver = null as ((ok: boolean) => void) | null;

export const useRun = create<RunStore>((set, get) => {
  const onEvent = (e: ScanEvent) => {
    const s = get();
    switch (e.type) {
      case 'stage': {
        const prev = s.stages[e.id];
        const status = e.status === 'start' ? 'running' : e.status;
        set({
          stages: { ...s.stages, [e.id]: { ...prev, status, model: e.model ?? prev.model, provider: e.provider ?? prev.provider, ms: e.ms ?? prev.ms, note: e.note ?? prev.note, startedAt: e.status === 'start' ? Date.now() : prev.startedAt } },
          log: e.note && e.status !== 'start' ? [...s.log, { t: Date.now(), text: `${e.label}: ${e.note}` }].slice(-40) : s.log,
        });
        break;
      }
      case 'quality':
        set({ quality: e.report });
        break;
      case 'candidates':
        set({ candidates: e.candidates, identity: e.status });
        break;
      case 'regions':
        set({ regions: e.regions });
        break;
      case 'sources':
        set({ sources: e.sources });
        break;
      case 'escalation':
        set({ escalation: e.request });
        break;
      case 'profile':
        set({ profile: e.profile });
        break;
      case 'error':
        set({ status: e.code === 'cancelled' ? 'cancelled' : 'error', error: { message: friendlyMessage(e.code, e.message), retryable: e.retryable } });
        break;
      case 'done':
        set({ status: 'done' });
        break;
    }
  };

  const save = async (profile: Profile, images: Blob[], sample: boolean) => {
    await putEntry({ id: profile.id, profile, images, savedAt: new Date().toISOString(), sample });
  };

  const base = () => ({
    status: 'running' as const,
    stages: freshStages(),
    quality: null,
    candidates: [],
    identity: null,
    regions: [],
    sources: [],
    profile: null,
    error: null,
    escalation: null,
    jobId: null,
    log: [],
  });

  return {
    status: 'idle',
    mode: 'sample',
    sampleId: null,
    photoUrls: [],
    dims: [],
    ...{ stages: freshStages(), quality: null, candidates: [], identity: null, regions: [], sources: [], profile: null, error: null, escalation: null, jobId: null, log: [] },

    async startSample(id) {
      const sample = sampleById(id);
      if (!sample) return;
      abort?.abort();
      abort = new AbortController();
      set({ ...base(), mode: 'sample', sampleId: id, photoUrls: [sample.photo], dims: [{ width: sample.width, height: sample.height }] });
      const settings = useSettings.getState();
      const speed = prefersReducedMotion() ? 0.25 : 1;
      const tasks = sampleTasks(sample.spec, sample.masks, { speed });
      const req: ScanRequest = {
        taught: taughtForScan(),
        views: [{ mime: 'image/jpeg', base64: 'c2FtcGxlLXBob3RvLW5vdC1zZW50', width: sample.width, height: sample.height, label: null }],
        hint: null,
        route: settings.route === 'consensus' ? 'consensus' : 'hosted',
        depth: 'deep',
        language: 'en',
        privacyTier: settings.privacyTier,
        prior: null,
        clientQuality: { sharpness: 260, brightness: 0.6, clipped: 0.01 },
        consent: { sendImages: true, acknowledgedAt: 'sample: nothing is sent' },
      };
      try {
        const profile = await runScan(req, { tasks, secondary: tasks, retriever: sampleRetriever(sample.spec, { speed }), emit: onEvent, signal: abort.signal, mode: 'sample' });
        if (profile) {
          const blob = await urlToBlob(sample.photo).catch(() => null);
          await save(profile, blob ? [blob] : [], true);
        }
      } catch (e) {
        set({ status: 'error', error: { message: userMessage(e, 'The example could not be played. Please try again.'), retryable: true } });
      }
    },

    async startExample(id) {
      const rec = recordedById(id);
      if (!rec) return get().startSample(id);
      abort?.abort();
      abort = new AbortController();
      const signal = abort.signal;
      const w = rec.profile.views[0]?.width ?? rec.meta.width;
      const h = rec.profile.views[0]?.height ?? rec.meta.height;
      set({ ...base(), mode: 'recorded', sampleId: id, photoUrls: [rec.photo], dims: [{ width: w, height: h }] });
      // Replay at the recorded pace, compressed to at most ~9 seconds (faster with reduced motion).
      const total = rec.events.at(-1)?.t ?? 0;
      const budget = prefersReducedMotion() ? 1500 : 9000;
      const k = total > budget ? budget / total : 1;
      let last = 0;
      try {
        for (const { t, e } of rec.events) {
          const wait = Math.max(0, (t - last) * k);
          last = t;
          if (wait) await new Promise<void>((res, rej) => {
            const timer = setTimeout(res, wait);
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              rej(new Error('cancelled'));
            });
          });
          if (e.type === 'profile') {
            const profile = { ...e.profile, trace: { ...e.profile.trace, mode: 'recorded' as const } };
            onEvent({ type: 'profile', profile });
            const blob = await urlToBlob(rec.photo).catch(() => null);
            await save(profile, blob ? [blob] : [], true);
          } else onEvent(e);
        }
      } catch {
        /* stopped */
      }
    },

    async startLive(images, hint, prior = null) {
      abort?.abort();
      stopFollow?.();
      abort = new AbortController();
      const settings = useSettings.getState();
      set({ ...base(), mode: 'live', sampleId: null, photoUrls: images.map((i) => i.url), dims: images.map((i) => ({ width: i.upload.width, height: i.upload.height })) });
      const routes = useHealth.getState().info?.routes;
      const req: ScanRequest = {
        taught: taughtForScan(),
        views: images.map((i) => i.upload),
        hint,
        // A mode that is not available on this server falls back to Standard.
        route: !routes || routes[settings.route] ? settings.route : 'hosted',
        depth: settings.depth,
        language: settings.language,
        privacyTier: settings.privacyTier,
        prior,
        clientQuality: { sharpness: images[0]!.metrics.sharpness, brightness: images[0]!.metrics.brightness, clipped: images[0]!.metrics.clipped },
        consent: { sendImages: true, acknowledgedAt: settings.consentAt ?? new Date().toISOString() },
      };
      try {
        const { jobId } = await startScan(req, abort.signal);
        set({ jobId });
        await new Promise<void>((resolve) => {
          stopFollow = followJob(
            jobId,
            (e) => {
              onEvent(e);
              if (e.type === 'profile') void save(e.profile, images.map((i) => i.blob), false);
              if (e.type === 'done' || e.type === 'error') resolve();
            },
            (message) => {
              set({ status: 'error', error: { message, retryable: true } });
              resolve();
            },
          );
        });
      } catch (e) {
        set({ status: 'error', error: { message: userMessage(e, 'The scan could not start. Please try again.'), retryable: true } });
      }
    },

    cancel() {
      const { jobId, mode } = get();
      abort?.abort();
      stopFollow?.();
      escalationResolver?.(false);
      if (mode === 'live' && jobId) void cancelJob(jobId);
      set({ status: 'cancelled', error: { message: 'Stopped. Nothing was saved.', retryable: true } });
    },

    answerEscalation(approve) {
      const { jobId, escalation } = get();
      if (!escalation) return;
      set({ escalation: null });
      if (escalationResolver) escalationResolver(approve);
      else if (jobId) void answerEscalation(jobId, escalation.id, approve);
    },

    reset() {
      abort?.abort();
      stopFollow?.();
      set({ ...base(), status: 'idle' });
    },
  };
});
