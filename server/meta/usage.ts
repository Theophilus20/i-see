/** Token usage and cost, from either Chat Completions or Responses usage objects. */
import type { Usage } from '../../src/shared/schema';

/**
 * Published prices in US dollars per million tokens, where Meta documents them.
 * Muse Wonder: $4 input / $20 output (dev.meta.ai). Muse Image: $0.01 per image.
 * Muse Spark prices are left null rather than guessed; set PRICE_<MODEL>_IN/OUT to fill them in.
 */
const PRICES: Record<string, { input: number; output: number } | undefined> = {
  'muse-wonder-1.0': { input: 4, output: 20 },
};
const IMAGE_PRICE: Record<string, number | undefined> = { 'muse-image-1.0': 0.01 };

function envPrice(model: string): { input: number; output: number } | undefined {
  const k = model.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const i = Number(process.env[`PRICE_${k}_IN`]);
  const o = Number(process.env[`PRICE_${k}_OUT`]);
  return Number.isFinite(i) && Number.isFinite(o) && (i > 0 || o > 0) ? { input: i, output: o } : undefined;
}

const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

export function usageFrom(raw: unknown, model: string, images = 0): Usage | null {
  if (!raw || typeof raw !== 'object') {
    const ip = IMAGE_PRICE[model];
    return images && ip != null ? { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, images, costUsd: ip * images } : null;
  }
  const u = raw as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const inputTokens = int(u.prompt_tokens ?? u.input_tokens);
  const outputTokens = int(u.completion_tokens ?? u.output_tokens);
  const reasoningTokens = int(u.completion_tokens_details?.reasoning_tokens ?? u.output_tokens_details?.reasoning_tokens);
  const cachedTokens = int(u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens);
  const price = PRICES[model] ?? envPrice(model);
  const imagePrice = IMAGE_PRICE[model];
  let costUsd: number | null = null;
  if (price) costUsd = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  if (imagePrice != null && images) costUsd = (costUsd ?? 0) + imagePrice * images;
  return { inputTokens, outputTokens, reasoningTokens, cachedTokens, images, costUsd: costUsd == null ? null : Math.round(costUsd * 1e6) / 1e6 };
}

export function addUsage(a: Usage | null, b: Usage | null): Usage | null {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    images: a.images + b.images,
    costUsd: a.costUsd == null && b.costUsd == null ? null : (a.costUsd ?? 0) + (b.costUsd ?? 0),
  };
}
