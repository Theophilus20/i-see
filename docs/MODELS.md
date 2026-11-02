# Models in I SEE

Every model is reached through one provider-neutral interface (`src/shared/tasks.ts`,
`ModelTasks`). The orchestrator never calls a provider directly, so a model can be swapped
by changing one adapter. This page says which Meta model does what, why, and how sure we
are that it works.

## Who does what

| Job | Model | Endpoint | What it receives |
|---|---|---|---|
| Look at the photo: candidates, parts to outline, markings, search queries | **Muse Spark** `muse-spark-1.3` | `POST /v1/chat/completions`, `response_format: json_schema`, `reasoning_effort: low` (`medium` on a deep scan), instructions in the `developer` role | The photo(s) and the person's note |
| Name each outlined part (twice, independently) and settle disagreements | **Muse Spark** | Chat Completions, json_schema, `reasoning_effort: high` | All regions numbered on the photo; then each region on its own (a close-up with the rest darkened, and the whole photo); for a disagreement, the region and the two names in a random order |
| Second look at a correction in Train | **Muse Spark** (`/api/v1/verify`) | Chat Completions, json_schema | The photo with the one region outlined, a close-up, and two names in a random order (it is not told whose is whose) |
| Outline parts so claims can point at them | **SAM 3.1** `sam-3.1` | `POST /v1/responses`, `stream: true`, one request per noun phrase, `metadata.include_confidence: "true"`; parsed with Meta's `@meta-sam/parser` | The photo and a short noun phrase (or box/points for click-to-outline) |
| Find sources | **Muse Spark** web search grounding | `POST /v1/responses` with `tools: [{type: "web_search"}]`; `url_citation` annotations become sources | Search queries only, never the photo |
| Write the profile (two calls in parallel) | **Muse Spark** | Chat Completions, json_schema, `reasoning_effort: medium` | Findings call: photo, regions, sources. Timeline/safety/what-if call: text only |
| Settle a close call between candidates | **Muse Wonder** `muse-wonder-1.0` | `POST /v1/responses`, `reasoning: {effort: "high"}`, `text.format: json_schema`, `store: false` | Text only: candidates, evidence, markings, source excerpts. Never the photo (image input is not documented for Wonder) |
| Cutaway drawing of what is inside the person's object | **Muse Image** `muse-image-1.0` | `POST /v1/responses`, `store: false`; image is the base64 `result` of the `image_generation_call` item | The person's photo (re-encoded, after consent), up to two public-domain reference pictures from Wikimedia Commons, and a text brief of the inner parts. Always shown labelled as a drawing; Muse Spark checks it against the photo |
| Ask by voice | **Muse Voice Transcribe** `muse-voice-transcribe-1.0` | `POST /v1/asr/transcribe`, multipart: `request` JSON part (`mode: PUSH_TO_TALK`, `audioEncoding: WAV`, `keywords`, `languageBias`) + `audio` part | Mono 16-bit PCM WAV at 16 or 24 kHz, at most 10 minutes / 32 MB. Part names from the profile are sent as `keywords` |
| Private route; independent second opinion | **Muse Spark Open** (open weights, 816B-A42B MoE, Muse Model License) | Any OpenAI-compatible host (`OPEN_WEIGHT_BASE_URL`) | The photo, to the host you chose |
| Local-first route | **Muse Glimmer** (30B dense, Apache 2.0) | Your own OpenAI-compatible server, e.g. Ollama | The photo, on your machine. Escalation to a hosted Meta model only after the person approves exactly what will be sent |
| Development | **Muse Code** | `muse` CLI, project rules in `.agents/AGENTS.md` | Source code only. Never production keys |

## Routes

| Route | Identify / write | Outlines | Sources | Resolve |
|---|---|---|---|---|
| `hosted` | Muse Spark | SAM 3.1 | connectors + Spark web search | Muse Wonder |
| `private` | Muse Spark Open (or Glimmer) | approximate pointers (no SAM: that would send the photo to Meta) | public connectors only | the open-weight model |
| `consensus` | Muse Spark, plus Muse Spark Open independently | SAM 3.1 | connectors + web search | Muse Wonder; the two identities are compared and disagreements shown |
| `local-first` | Muse Glimmer; Muse Spark only after approval | SAM 3.1 after approval | connectors | Muse Wonder after approval |

## Privacy tiers

Meta offers `-contributor` variants of Muse Spark (`muse-spark-1.3-contributor`,
`muse-spark-1.2-contributor`) that cost less and **are used to improve Meta's products**.
I SEE defaults to the private ids everywhere. The contributor tier is used only if the
server sets `PRIVACY_TIER=contributor` or a request asks for it, and the capability table
(`GET /api/v1/health`) shows `dataUse: used-to-improve` when it is in effect. For Wonder,
Image, SAM 3.1 and Voice Transcribe no contributor variant is documented; their data use is
reported as `unknown`, and you should read Meta's terms.

## Structured output and repair

Muse Spark gets a strict JSON Schema generated from Zod (`toStrictJsonSchema`: every key
required, `additionalProperties: false`, no `$ref`, because recursive schemas are rejected).
The reply is validated again with Zod. If it does not match, one repair request shows the
model the exact problems; a second failure is an error, never a guess. Open-weight hosts
that do not enforce `json_schema` get the schema in the prompt and the same validation.

## Reliability

`server/meta/http.ts`: retries 408/409/425/429/5xx, timeouts and network errors with
exponential backoff and full jitter, honouring `Retry-After`; never retries 400, 401, 403,
404 or 422; a per-host circuit breaker opens after 5 failed calls and lets one probe through
after 30 s. Usage (including reasoning tokens) is recorded per stage. Costs are computed only
where Meta publishes a price (Muse Wonder $4 / $20 per million input / output tokens,
Muse Image $0.01 per image); Spark cost is shown as unknown unless you set
`PRICE_MUSE_SPARK_1_3_IN` / `_OUT`.

## Capability registry and probing

`server/capabilities.ts` lists each role, model, inputs, outputs and data use, marked
`documented`. `npm run models:probe` sends one tiny real request per role (vision +
json_schema, Wonder json_schema, SAM on a generated square, web search, a one-second WAV,
optionally Muse Image with `--with-image`) and prints a matrix. `--save probe.json` plus
`PROBE_RESULTS=probe.json` upgrades the entries in `/health` to `probed` or `failed`.

## What has and has not been verified

- The request and response shapes come from Meta's documentation and its official cookbook
  code (`meta-models` cookbook, `@meta-sam/parser` README). The SAM adapter is tested against
  the real wire sample published in the parser's README.
- The gateway is tested end to end against a **mock** Meta Model API
  (`tests/server/mock-meta.ts`) that mirrors those shapes: full scans over HTTP and SSE on all
  four routes, retries, circuit breaking, schema repair, escalation, cancellation, voice and
  illustration.
- **The live Meta Model API, the open-weight hosts and the public connectors were not
  reachable from the sandbox this was built in.** Run `npm run models:probe` with a real key
  before relying on any of it. Connector fixtures in `tests/server/fixtures` were written by
  hand in each API's documented shape, not recorded from live responses.
- The Baseten slug `meta-models/muse-spark-open-1026` comes from the project brief and
  should be confirmed in the Baseten model library before use.
