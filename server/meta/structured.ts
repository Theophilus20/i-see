/**
 * Structured output with a safety net.
 *
 * Asks for JSON that matches a schema (response_format json_schema on Chat Completions,
 * text.format on the Responses API), validates it with Zod, and if it does not match,
 * makes exactly one repair attempt that shows the model what was wrong. A second failure
 * is an error, not a guess.
 */
import type { z } from 'zod';
import { extractJson, toStrictJsonSchema } from '../../src/shared/model-io';
import type { Usage } from '../../src/shared/schema';
import type { ImagePayload } from '../../src/shared/tasks';
import { ApiError, type HttpClient } from './http';
import { addUsage, usageFrom } from './usage';
import { salvage } from '../../src/shared/salvage';
import { log } from '../log';
import { dataUrl } from './sam';

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high';

export interface ChatStructuredRequest<S extends z.ZodType> {
  client: HttpClient;
  model: string;
  schema: S;
  name: string;
  system: string;
  user: string;
  images?: ImagePayload[];
  /** `json_schema`: provider enforces the schema. `prompt`: schema goes in the prompt and is checked here. */
  mode: 'json_schema' | 'prompt';
  /** `developer` for the Meta Model API (recommended there); `system` for most open-weight servers. */
  instructionRole: 'developer' | 'system';
  reasoningEffort?: ReasoningEffort | null;
  maxTokens?: number | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface StructuredResult<T> {
  value: T;
  usage: Usage | null;
  ms: number;
  repaired: boolean;
}

const schemaCache = new WeakMap<z.ZodType, Record<string, unknown>>();
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  let s = schemaCache.get(schema);
  if (!s) {
    s = toStrictJsonSchema(schema);
    schemaCache.set(schema, s);
  }
  return s;
}

/** Text content of a chat completion, whether a string or an array of parts. */
export function chatText(data: unknown): { text: string; refusal: string | null } {
  const choice = (data as { choices?: Array<{ message?: { content?: unknown; refusal?: unknown } }> })?.choices?.[0];
  const content = choice?.message?.content;
  const refusal = typeof choice?.message?.refusal === 'string' ? choice.message.refusal : null;
  if (typeof content === 'string') return { text: content, refusal };
  if (Array.isArray(content)) {
    return { text: content.map((p) => (typeof p === 'string' ? p : typeof (p as { text?: unknown })?.text === 'string' ? (p as { text: string }).text : '')).join(''), refusal };
  }
  return { text: '', refusal };
}

/** Concatenated output_text of a Responses API result. */
export function responsesText(data: unknown): string {
  const d = data as { output_text?: unknown; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: unknown }> }> };
  if (typeof d?.output_text === 'string' && d.output_text) return d.output_text;
  return (d?.output ?? [])
    .filter((o) => o?.type === 'message')
    .flatMap((o) => o.content ?? [])
    .filter((c) => c?.type === 'output_text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('');
}

function issuesText(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

function tryParse<S extends z.ZodType>(schema: S, text: string, name = 'output'): { ok: true; value: z.infer<S> } | { ok: false; problem: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch {
    return { ok: false, problem: 'The reply was not a JSON object.' };
  }
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data as z.infer<S> };
  // Mechanical slips (a renamed key, a missing nullable, an enum in capitals) are fixed here
  // instead of costing a second long call.
  const s = salvage(schema, jsonSchemaFor(schema), raw);
  if (s.ok) {
    log('info', 'structured output salvaged', { name, problem: issuesText(r.error).slice(0, 300), dropped: s.fixes });
    return { ok: true, value: s.value };
  }
  return { ok: false, problem: issuesText(r.error) };
}

/** Lower reasoning effort used when a call timed out or needs a quick repair ('low' is accepted by every endpoint we use). */
const QUICK: ReasoningEffort = 'low';

export async function chatStructured<S extends z.ZodType>(req: ChatStructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
  const schema = jsonSchemaFor(req.schema);
  const system =
    req.mode === 'prompt'
      ? `${req.system}\n\nReturn ONLY one JSON object, no prose and no code fences, that matches this JSON Schema exactly (every key present; use null where unknown):\n${JSON.stringify(schema)}`
      : req.system;
  const userContent: unknown =
    req.images && req.images.length
      ? [{ type: 'text', text: req.user }, ...req.images.map((v) => ({ type: 'image_url', image_url: { url: dataUrl(v) } }))]
      : req.user;
  const messages: Array<Record<string, unknown>> = [
    { role: req.instructionRole, content: system },
    { role: 'user', content: userContent },
  ];
  const base: Record<string, unknown> = { model: req.model };
  if (req.mode === 'json_schema') base.response_format = { type: 'json_schema', json_schema: { name: req.name, schema } };
  if (req.reasoningEffort) base.reasoning_effort = req.reasoningEffort;
  if (req.maxTokens) base.max_completion_tokens = req.maxTokens;

  // A timeout is not retried at the same effort (that doubles the wait): one retry thinks less.
  let first: { data: unknown; ms: number };
  try {
    first = await req.client.postJson('/chat/completions', { ...base, messages }, { signal: req.signal, timeoutMs: req.timeoutMs, retryTimeouts: !req.reasoningEffort });
  } catch (e) {
    if (!(e instanceof ApiError && e.code === 'timeout' && req.reasoningEffort)) throw e;
    log('warn', 'retrying with less reasoning', { name: req.name, effort: req.reasoningEffort });
    first = await req.client.postJson('/chat/completions', { ...base, reasoning_effort: QUICK, messages }, { signal: req.signal, timeoutMs: req.timeoutMs, retryTimeouts: false });
  }
  let usage = usageFrom((first.data as { usage?: unknown }).usage, req.model, req.images?.length ?? 0);
  const out1 = chatText(first.data);
  if (out1.refusal && !out1.text) throw new ApiError(`The model declined: ${out1.refusal.slice(0, 200)}`, 200, 'refusal', false, req.client.provider);
  const p1 = tryParse(req.schema, out1.text, req.name);
  if (p1.ok) return { value: p1.value, usage, ms: first.ms, repaired: false };

  // One repair attempt. The images are not sent again; the model has its own previous answer.
  const repairMessages = [
    { role: req.instructionRole, content: system },
    { role: 'user', content: req.user },
    { role: 'assistant', content: out1.text.slice(0, 60_000) },
    { role: 'user', content: `That JSON does not match the required schema: ${p1.problem}. Return the corrected JSON object only.` },
  ];
  const second = await req.client.postJson('/chat/completions', { ...base, ...(req.reasoningEffort ? { reasoning_effort: QUICK } : {}), messages: repairMessages }, { signal: req.signal, timeoutMs: req.timeoutMs });
  usage = addUsage(usage, usageFrom((second.data as { usage?: unknown }).usage, req.model));
  const p2 = tryParse(req.schema, chatText(second.data).text, req.name);
  if (p2.ok) return { value: p2.value, usage, ms: first.ms + second.ms, repaired: true };
  throw new ApiError(`The model's answer did not match the expected structure (${p2.problem.slice(0, 200)}).`, 200, 'schema_mismatch', true, req.client.provider);
}

export interface ResponsesStructuredRequest<S extends z.ZodType> {
  client: HttpClient;
  model: string;
  schema: S;
  name: string;
  system: string;
  user: string;
  reasoningEffort?: ReasoningEffort | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Structured output on the Responses API (used for Muse Wonder). Text only: no images are ever attached. */
export async function responsesStructured<S extends z.ZodType>(req: ResponsesStructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
  const schema = jsonSchemaFor(req.schema);
  const body = (input: unknown[]) => ({
    model: req.model,
    input,
    store: false,
    text: { format: { type: 'json_schema', name: req.name, schema } },
    ...(req.reasoningEffort ? { reasoning: { effort: req.reasoningEffort } } : {}),
  });
  const input = [
    { role: 'developer', content: [{ type: 'input_text', text: req.system }] },
    { role: 'user', content: [{ type: 'input_text', text: req.user }] },
  ];
  const first = await req.client.postJson('/responses', body(input), { signal: req.signal, timeoutMs: req.timeoutMs });
  let usage = usageFrom((first.data as { usage?: unknown }).usage, req.model);
  const t1 = responsesText(first.data);
  const p1 = tryParse(req.schema, t1, req.name);
  if (p1.ok) return { value: p1.value, usage, ms: first.ms, repaired: false };
  const repair = [
    ...input,
    { role: 'assistant', content: [{ type: 'output_text', text: t1.slice(0, 60_000) }] },
    { role: 'user', content: [{ type: 'input_text', text: `That JSON does not match the required schema: ${p1.problem}. Return the corrected JSON object only.` }] },
  ];
  const second = await req.client.postJson('/responses', body(repair), { signal: req.signal, timeoutMs: req.timeoutMs });
  usage = addUsage(usage, usageFrom((second.data as { usage?: unknown }).usage, req.model));
  const p2 = tryParse(req.schema, responsesText(second.data), req.name);
  if (p2.ok) return { value: p2.value, usage, ms: first.ms + second.ms, repaired: true };
  throw new ApiError(`The model's answer did not match the expected structure (${p2.problem.slice(0, 200)}).`, 200, 'schema_mismatch', true, req.client.provider);
}
