/**
 * Hand-authored sample runs.
 *
 * These let the app be explored without an API key. No model is called: each stage
 * returns what is written here, and the result then goes through the real pipeline
 * (the same firewall, calculator and assembler as a live run). Everything a sample
 * cites is a real page, and every quote was copied from that page's text.
 * The UI labels these runs "Sample run, no model called" wherever they appear.
 */
import type { IdentifyOutput, InsideDraft, ProfileCoreDraft, ProfileExtrasDraft, ResolveOutput } from '../../src/shared/model-io';
import type { Source } from '../../src/shared/schema';

export interface MaskEntry {
  part: string;
  label: string;
  path: string;
  box: { x: number; y: number; w: number; h: number };
  anchor: { x: number; y: number };
  area: number;
}

export interface SampleSpec {
  id: string;
  title: string;
  /** One line for the picker. */
  blurb: string;
  /** What this sample demonstrates. */
  shows: string[];
  /** Part ids in region order: the n-th part becomes region r(n+1). */
  parts: string[];
  identify: IdentifyOutput;
  sources: Source[];
  core: ProfileCoreDraft;
  extras: ProfileExtrasDraft;
  resolve: ResolveOutput | null;
  secondOpinion: IdentifyOutput | null;
  /** The prepared inside view (what each part does and how it works). */
  inside: InsideDraft | null;
  /** Suggested follow-up questions with prepared answers, for the Ask panel in sample mode. */
  questions: Array<{ q: string; segments: Array<{ text: string; basis: 'observed' | 'sourced' | 'inferred' | 'hypothesis' | 'unknown'; confidence: number | null; regionIds: string[]; sourceIds: string[]; quote: string | null }> }>;
}

export const RETRIEVED_AT = '2026-10-28T09:00:00.000Z';
