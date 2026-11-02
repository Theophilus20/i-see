/**
 * ModelTasks and Retriever for sample runs. No model is called and nothing leaves
 * the device. Each stage waits a moment so the pipeline can be watched, then
 * returns the hand-authored draft. The real orchestrator, firewall and calculator
 * do the rest, exactly as in a live run.
 */
import type { AskOutput, CompareOutput } from '../../src/shared/model-io';
import type { Region } from '../../src/shared/schema';
import type { ModelTasks, Retriever, Tracked } from '../../src/shared/tasks';
import { PROMPT_VERSION } from '../../src/shared/prompts';
import type { MaskEntry, SampleSpec } from './types';

export const SAMPLE_MODEL = 'Sample run';
export const SAMPLE_PROVIDER = 'No model called';

/** Which model would do this stage in a live run on the hosted route. Shown beside sample stages. */
export const LIVE_EQUIVALENT: Record<string, string> = {
  identify: 'Muse Spark 1.3',
  segment: 'SAM 3.1',
  retrieve: 'Connectors + Muse Spark search',
  compose: 'Muse Spark 1.3',
  resolve: 'Muse Wonder 1.0',
  'second-opinion': 'Muse Spark Open',
  illustrate: 'Muse Image 1.0',
  transcribe: 'Muse Voice Transcribe 1.0',
  local: 'Muse Glimmer',
};

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('cancelled'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('cancelled'));
    });
  });

function tracked<T>(value: T, ms: number): Tracked<T> {
  return { value, usage: null, model: SAMPLE_MODEL, provider: SAMPLE_PROVIDER, ms, promptVersion: PROMPT_VERSION };
}

export function regionsFromMasks(spec: SampleSpec, masks: MaskEntry[], view = 0): Region[] {
  const out: Region[] = [];
  spec.parts.forEach((part, i) => {
    const m = masks.find((x) => x.part === part);
    if (!m) return;
    const concept = spec.identify.concepts[i];
    out.push({
      id: `r${i + 1}`,
      label: concept?.phrase ?? m.label,
      kind: 'mask',
      source: 'sample',
      view,
      box: m.box,
      path: m.path,
      anchor: m.anchor,
      area: m.area,
      confidence: null,
    });
  });
  return out;
}

export interface SamplePacing {
  /** Multiplies every delay. 0 makes the run instant (tests, reduced motion). */
  speed: number;
}

export function sampleTasks(spec: SampleSpec, masks: MaskEntry[], pacing: SamplePacing = { speed: 1 }): ModelTasks {
  const d = (ms: number, signal?: AbortSignal) => (pacing.speed > 0 ? wait(ms * pacing.speed, signal) : Promise.resolve());
  return {
    id: `sample:${spec.id}`,
    async identify(_input, ctx) {
      await d(1500, ctx.signal);
      return tracked(structuredClone(spec.identify), 1500);
    },
    async segment(input, ctx) {
      await d(1100, ctx.signal);
      return tracked({ regions: regionsFromMasks(spec, masks, input.viewIndex), diagnostics: [] }, 1100);
    },
    async compose(_input, ctx) {
      await d(1900, ctx.signal);
      return tracked({ core: structuredClone(spec.core), extras: structuredClone(spec.extras) }, 1900);
    },
    async resolve(_input, ctx) {
      await d(1600, ctx.signal);
      if (!spec.resolve) throw new Error('This sample has nothing to resolve.');
      return tracked(structuredClone(spec.resolve), 1600);
    },
    async ask(input, ctx) {
      await d(900, ctx.signal);
      const q = input.question.trim().toLowerCase();
      const hit = spec.questions.find((x) => x.q.toLowerCase() === q);
      const out: AskOutput = hit
        ? { segments: structuredClone(hit.segments), followUps: spec.questions.filter((x) => x !== hit).map((x) => x.q), needsEvidence: null, refused: null }
        : {
            segments: [
              {
                text: 'This is a sample run, so only the suggested questions have prepared answers. Connect the I SEE server to ask anything.',
                basis: 'unknown',
                confidence: null,
                regionIds: [],
                sourceIds: [],
                quote: null,
              },
            ],
            followUps: spec.questions.map((x) => x.q),
            needsEvidence: null,
            refused: null,
          };
      return tracked(out, 900);
    },
    async compare(input, ctx) {
      await d(900, ctx.signal);
      const out: CompareOutput = {
        headline: `Comparisons need a live model. Here is what the two profiles already say about ${input.a.displayName} and ${input.b.displayName}.`,
        differences: [],
        similarities: [],
        advice: null,
      };
      return tracked(out, 900);
    },
    async illustrate() {
      throw new Error('Illustrations are only available for your own photos.');
    },
    async transcribe() {
      throw new Error('Voice questions are only available with the I SEE server.');
    },
    async inside(_input, ctx) {
      await d(1200, ctx.signal);
      if (!spec.inside) throw new Error('This example has no prepared inside view.');
      return tracked(structuredClone(spec.inside), 1200);
    },
    async screenSources(input) {
      return tracked({ sources: input.sources.map((x) => ({ id: x.id, relevant: true })) }, 0);
    },
    async translate() {
      throw new Error('Translation works when I SEE is online.');
    },
    async glance() {
      throw new Error('Live camera recognition needs the I SEE server.');
    },
    async secondOpinion(_input, ctx) {
      await d(2200, ctx.signal);
      if (!spec.secondOpinion) throw new Error('No second opinion in this sample.');
      return tracked(structuredClone(spec.secondOpinion), 2200);
    },
  };
}

export function sampleRetriever(spec: SampleSpec, pacing: SamplePacing = { speed: 1 }): Retriever {
  return {
    async retrieve(_q, ctx) {
      if (pacing.speed > 0) await wait(800 * pacing.speed, ctx.signal);
      return { sources: structuredClone(spec.sources), notes: ['Sample sources: excerpts stored with the sample, not fetched now.'] };
    },
  };
}
