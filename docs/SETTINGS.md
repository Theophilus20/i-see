# Settings

I SEE reads its settings from environment variables. On your own computer, put them in a
file named `.env` in the project folder, one per line (`NAME=value`). `.env` is never
uploaded to GitHub. On a host such as Railway, enter them as the service's variables.

Only `MODEL_API_KEY` is needed to examine your own photos:

```
MODEL_API_KEY=your key from https://dev.meta.ai
```

Keys stay on the server: they are never sent to the browser, never logged, and must never be
given to Muse Code or any other development tool.

## Meta Model API

Muse Spark, Muse Wonder, Muse Image, Muse Voice Transcribe and SAM 3.1.

| Setting | Default | What it does |
|---|---|---|
| `MODEL_API_KEY` | (none) | Your key, format `LLM\|<id>\|<secret>`. `META_MODEL_API_KEY` is accepted too. |
| `META_API_BASE` | `https://api.meta.ai/v1` | The API address. |
| `PRIVACY_TIER` | `private` | `private`: `muse-spark-1.3`, which Meta says is not used to improve its products. `contributor`: `muse-spark-1.3-contributor`, cheaper, and used to improve Meta's products. |
| `MODEL_SPARK`, `MODEL_SPARK_CONTRIBUTOR`, `MODEL_WONDER`, `MODEL_IMAGE`, `MODEL_ASR`, `MODEL_SAM` | `muse-spark-1.3`, `muse-spark-1.3-contributor`, `muse-wonder-1.0`, `muse-image-1.0`, `muse-voice-transcribe-1.0`, `sam-3.1` | Model ids. Change them only if Meta publishes new versions. |
| `SEARCH_GROUNDING` | `true` | Muse Spark web search. Only search words are sent, never photos. |

## Muse Spark Open (open weights)

Powers the **Private** route and the independent opinion on the **Second opinion** route.
Works with any OpenAI-compatible host.

| Setting | What it does |
|---|---|
| `OPEN_WEIGHT_BASE_URL` | The host's address, for example `https://inference.baseten.co/v1`, `https://api.fireworks.ai/inference/v1`, `https://openrouter.ai/api/v1`, or `http://localhost:8000/v1` for vLLM. |
| `OPEN_WEIGHT_API_KEY` | Your key for that host. |
| `OPEN_WEIGHT_MODEL` | The model name on that host. Check your provider's exact name (on Baseten: `meta-models/muse-spark-open-1026`). |
| `OPEN_WEIGHT_JSON_SCHEMA` | `false`. Set `true` only if the host enforces `response_format` JSON schema; otherwise the JSON is asked for in the prompt and checked. |
| `OPEN_WEIGHT_VISION` | `true` if the host accepts images. |
| `OPEN_WEIGHT_REASONING_EFFORT` | `true` to send a reasoning effort per task. Set `false` for hosts that reject it. |

## Muse Glimmer (on your own computer)

Powers the **On my own computer** route: nothing leaves the machine unless you approve it.

| Setting | What it does |
|---|---|
| `LOCAL_BASE_URL` | Your local server, for example `http://localhost:11434/v1` for Ollama. |
| `LOCAL_MODEL` | `muse-glimmer` by default. |
| `LOCAL_API_KEY` | If your local server needs one. |
| `LOCAL_JSON_SCHEMA`, `LOCAL_VISION` | As for the open-weight host above. |

## Server

| Setting | Default | What it does |
|---|---|---|
| `PORT` | `8787` | The port the server listens on. Hosts set this themselves. |
| `HOST` | `127.0.0.1` | Set `0.0.0.0` on a host such as Railway or Render, so it can be reached from outside. |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Other web addresses allowed to call the API. Not needed when the app and the API are served together. |
| `RATE_PER_MINUTE` | `30` | Requests allowed per visitor per minute. |
| `MAX_IMAGE_BYTES` | `8388608` | The largest photo accepted (8 MB). |
| `REQUEST_TIMEOUT_MS` | `120000` | How long to wait for one model call (2 minutes). |
| `LABEL_METHOD` | `segments` | How parts are found: `segments` (regions traced from the photo, then named) or `boxes` (each part's box outlined, then checked). |
| `CONNECTORS` | all | Which reference sources to use, as a comma list of `wikipedia,wikidata,met,aic,cpsc,nhtsa,gbif,openfoodfacts,ifixit`. |
| `CONTACT_EMAIL` | (none) | Sent to public sources that ask for a contact, such as Wikipedia. |
| `TRUST_PROXY` | `0` | Set `1` only behind a trusted proxy (such as Railway's), so rate limits use the visitor's address. |
| `STATIC_DIR` | `dist` with `npm start` | The folder of the built web app. |
| `PROBE_RESULTS` | (none) | Results saved by `npm run models:probe -- --save probe.json`. |
| `LOG_LEVEL` | `info` | How much the server logs. |
