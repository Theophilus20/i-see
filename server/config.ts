/**
 * Server configuration, read once from the environment.
 *
 * Keys live here and nowhere else: they are never sent to the browser, never
 * logged, and never passed to Muse Code or any development tool.
 */
import type { PrivacyTier } from '../src/shared/tasks';

export interface ModelIds {
  /** Muse Spark, private tier: Meta states these requests are not used to improve its products. */
  spark: string;
  /** Muse Spark, contributor tier: cheaper, and used to improve Meta's products. Opt-in only. */
  sparkContributor: string;
  wonder: string;
  image: string;
  asr: string;
  sam: string;
}

export interface EndpointConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  /** Whether this endpoint accepts response_format json_schema. Unknown providers default to prompt-only JSON. */
  jsonSchema: boolean;
  /** Whether this endpoint accepts image input (Muse Spark Open and Muse Glimmer are multimodal). */
  vision: boolean;
  /** Whether the host accepts `reasoning_effort` (Baseten's Muse Spark Open does; without it, it reasons at its slowest level). */
  reasoning: boolean;
  label: string;
}

export interface Config {
  port: number;
  host: string;
  meta: { baseUrl: string; apiKey: string | null; models: ModelIds };
  /** Muse Spark Open on a hosted open-weight provider (Baseten, Fireworks, OpenRouter, vLLM...). */
  openWeight: EndpointConfig | null;
  /** Muse Glimmer, usually local (Ollama, llama.cpp, vLLM). */
  local: EndpointConfig | null;
  privacyTier: PrivacyTier;
  ratePerMinute: number;
  maxImageBytes: number;
  maxViews: number;
  maxAudioSeconds: number;
  maxAudioBytes: number;
  allowedOrigins: string[];
  searchGrounding: boolean;
  connectors: string[] | null;
  staticDir: string | null;
  requestTimeoutMs: number;
  /**
   * How parts are found on a photo: 'segments' (regions traced from the pixels, then named; the
   * default) or 'boxes' (each part's box outlined, then checked).
   */
  labelMethod: 'segments' | 'boxes';
  version: string;
}

const ALL_CONNECTORS = ['wikipedia', 'wikidata', 'met', 'aic', 'cpsc', 'nhtsa', 'gbif', 'openfoodfacts', 'ifixit'] as const;
export const CONNECTOR_IDS: readonly string[] = ALL_CONNECTORS;

type Env = Record<string, string | undefined>;

// Values pasted into a host's settings page often arrive with quotes or invisible characters
// around them ("LLM|…" with its quotes, a zero-width space from a web page). Both are removed.
const str = (env: Env, k: string): string | null => {
  let v = env[k]?.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim();
  if (v && v.length >= 2 && /^(["'`]).*\1$/s.test(v)) v = v.slice(1, -1).trim();
  return v ? v : null;
};
const num = (env: Env, k: string, d: number): number => {
  const v = Number(env[k]);
  return Number.isFinite(v) && v > 0 ? v : d;
};
const bool = (env: Env, k: string, d: boolean): boolean => {
  const v = env[k]?.trim().toLowerCase();
  if (v === undefined || v === '') return d;
  return v === '1' || v === 'true' || v === 'yes';
};
const stripSlash = (u: string) => u.replace(/\/+$/, '');

export function loadConfig(env: Env = process.env): Config {
  const metaKey = str(env, 'MODEL_API_KEY') ?? str(env, 'META_MODEL_API_KEY') ?? str(env, 'META_API_KEY');
  const tier = str(env, 'PRIVACY_TIER') === 'contributor' ? 'contributor' : 'private';

  const owBase = str(env, 'OPEN_WEIGHT_BASE_URL');
  const openWeight: EndpointConfig | null = owBase
    ? {
        baseUrl: stripSlash(owBase),
        apiKey: str(env, 'OPEN_WEIGHT_API_KEY'),
        model: str(env, 'OPEN_WEIGHT_MODEL') ?? 'meta-models/muse-spark-open',
        jsonSchema: bool(env, 'OPEN_WEIGHT_JSON_SCHEMA', false),
        vision: bool(env, 'OPEN_WEIGHT_VISION', true),
        reasoning: bool(env, 'OPEN_WEIGHT_REASONING_EFFORT', true),
        label: 'Muse Spark Open',
      }
    : null;

  const localBase = str(env, 'LOCAL_BASE_URL');
  const local: EndpointConfig | null = localBase
    ? {
        baseUrl: stripSlash(localBase),
        apiKey: str(env, 'LOCAL_API_KEY'),
        model: str(env, 'LOCAL_MODEL') ?? 'muse-glimmer',
        jsonSchema: bool(env, 'LOCAL_JSON_SCHEMA', false),
        vision: bool(env, 'LOCAL_VISION', true),
        reasoning: bool(env, 'LOCAL_REASONING_EFFORT', false),
        label: 'Muse Glimmer',
      }
    : null;

  const connectorList = str(env, 'CONNECTORS');
  const connectors = connectorList
    ? connectorList
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => (ALL_CONNECTORS as readonly string[]).includes(s))
    : null;

  return {
    port: num(env, 'PORT', 8787),
    host: str(env, 'HOST') ?? '127.0.0.1',
    meta: {
      baseUrl: stripSlash(str(env, 'META_API_BASE') ?? 'https://api.meta.ai/v1'),
      apiKey: metaKey,
      models: {
        spark: str(env, 'MODEL_SPARK') ?? 'muse-spark-1.3',
        sparkContributor: str(env, 'MODEL_SPARK_CONTRIBUTOR') ?? 'muse-spark-1.3-contributor',
        wonder: str(env, 'MODEL_WONDER') ?? 'muse-wonder-1.0',
        image: str(env, 'MODEL_IMAGE') ?? 'muse-image-1.0',
        asr: str(env, 'MODEL_ASR') ?? 'muse-voice-transcribe-1.0',
        sam: str(env, 'MODEL_SAM') ?? 'sam-3.1',
      },
    },
    openWeight,
    local,
    privacyTier: tier,
    ratePerMinute: num(env, 'RATE_PER_MINUTE', 30),
    maxImageBytes: num(env, 'MAX_IMAGE_BYTES', 8 * 1024 * 1024),
    maxViews: 6,
    maxAudioSeconds: 600,
    maxAudioBytes: 32 * 1024 * 1024,
    allowedOrigins: (str(env, 'ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    searchGrounding: bool(env, 'SEARCH_GROUNDING', true),
    connectors,
    staticDir: str(env, 'STATIC_DIR'),
    requestTimeoutMs: num(env, 'REQUEST_TIMEOUT_MS', 120_000),
    labelMethod: str(env, 'LABEL_METHOD') === 'boxes' ? 'boxes' : 'segments',
    version: str(env, 'APP_VERSION') ?? '0.1.0',
  };
}

/** The Spark model id for a privacy tier. Private is the default everywhere. */
export function sparkModel(cfg: Config, tier: PrivacyTier): string {
  return tier === 'contributor' ? cfg.meta.models.sparkContributor : cfg.meta.models.spark;
}
