# Architecture

This is the as-built design. The original brief is in `docs/SPEC-original.txt` (Universal
Object Intelligence Architecture v2.0); deviations from it are listed at the end.

## Shape

```
browser (React, Vite)                     gateway (Node, Hono)                  providers
──────────────────────                    ────────────────────                  ─────────
camera / file  ─► re-encode, measure ─►   POST /api/v1/scans  ─► orchestrator ─► Meta Model API
                                          GET  /jobs/:id/events (SSE)            · Muse Spark (vision, writing, search)
Darkroom  ◄──────── ScanEvents ◄────────  stage, candidates, regions,           · SAM 3.1 (outlines)
Workspace ◄──────── Profile               sources, profile                     · Muse Wonder (resolve)
Passport (IndexedDB, this device only)    POST /segment /ask /compare           · Muse Image (cutaway)
                                               /illustrate /transcribe          · Muse Voice Transcribe
                                          GET  /health (capabilities)          open-weight hosts
                                                                               · Muse Spark Open, Muse Glimmer
                                                                              public sources (9 connectors)
```

`src/shared/` holds everything both sides need: the schemas, the prompts, and the engine
(orchestrator, firewall, calculator, assembler). The orchestrator only knows two interfaces,
`ModelTasks` and `Retriever` (`src/shared/tasks.ts`). The server implements them with Meta
and open-weight adapters; the browser implements them with hand-authored samples. A sample
run therefore goes through exactly the same firewall and calculator as a live one.

## The pipeline (`src/shared/orchestrator.ts`)

1. **Intake** (device): orientation applied, long edge ≤ 2048 px, JPEG re-encode (drops EXIF
   and GPS). The server re-encodes again with `sharp` and checks magic bytes.
2. **Quality** (device): Laplacian variance, mean luminance, clipped share. Live hints in the
   camera; merged later with the vision model's own judgement.
3. **Identify** (Muse Spark): neutral description first, then up to five candidates with
   evidence for, against and missing; up to ten short noun phrases worth outlining; verbatim
   markings; retrieval queries. On `consensus`, Muse Spark Open runs the same task
   independently, in parallel.
4. **Segment ∥ Retrieve**: regions first, names second (Set-of-Mark). Muse Spark says which
   parts it can see and gives the whole object's box; SAM 3.1 outlines the whole object, then
   traces the region under a grid of points over it, under each part seen, and each part found
   by its short name; duplicates, regions made of other regions, and regions that are not at
   least three quarters on the object are removed. Muse Spark (at `reasoning_effort: high`) then
   names every region twice, independently: all of them at once, numbered on the photo, and
   each one on its own, up close, with the rest of the photo darkened. Agreement confirms a
   name; a close look that sees no part, or an outline that fits badly, drops the region; a
   disagreement goes to a third look that chooses between the two names (a Quick look names
   each region once). Masks are
   decoded to SVG paths with `@meta-sam/parser` (see `server/meta/label.ts`; `LABEL_METHOD=boxes`
   switches to outlining boxes and checking them). Parts are found on a working copy of about
   1,500 px (SAM 3 works at about 1,000 px inside) and mapped back onto the full image, and
   each label's dot sits at the point of its own part farthest from the part's edges. The photo shows names in columns down each
   side, joined to their parts by leaders (boundary labelling), never on top of the object.
   Connectors and Spark web search fetch sources. If SAM is unavailable, the vision model's
   rough pointers become dashed "approximate" rings.
5. **Compose** (Muse Spark, two parallel calls): findings, parts and conflicts; then timeline,
   safety, related objects, live values and what-if calculations.
6. **Reconcile** (code): the firewall and the calculator, below.
7. **Resolve** (Muse Wonder, text only): runs only when the leader is below 0.55 or within
   0.15 of the runner-up. Re-ranks, rules candidates out, and picks the single most
   informative next photo or check. "Take that photo" starts a follow-up scan that carries
   the profile digest as `prior`.

Every stage records model, provider, time, usage and a note into the trace, which the
Method tab shows. A failing stage degrades the profile and says so; it never hides it.

## The epistemic firewall (`src/shared/firewall.ts`)

Prompts ask; code checks.

- Region and source ids that do not exist are removed.
- A **Cited** claim must quote its source. The quote is matched against the retrieved text
  (case, accents and punctuation ignored; `…` may skip text; at least 12 characters). No match
  means it becomes **Reasoned** or **Guess**, and the reason is attached to the finding.
- Citations supplied by the search tool itself are kept but marked "tool-cited".
- Safety claims on hazardous objects need a tier 1 to 3 source to stay Cited.
- Confidence is capped by grade (Guess ≤ 0.6, Reasoned ≤ 0.88).
- Assurances that something is safe to eat, take, touch or operate are replaced by a fixed,
  category-specific "cannot be told from a photo" statement. Warnings are left alone.
- Live values must appear verbatim in a retrieved source and get a recheck date.
- Near-duplicates are merged, keeping the better-evidenced one.

## The calculator (`src/shared/calc.ts`)

What-if numbers come from a hand-written parser and evaluator, not from a model and not from
`eval`: numbers, declared keys, `+ − × ÷ ^`, parentheses and 16 maths functions. No property
access, strings, assignment or user functions. Size and depth are capped. On top of the
arithmetic it carries **physical dimensions** (length, mass, time, temperature, current,
amount) through every step and rejects a step whose result does not match its declared unit.
A calculation that fails is shown as a hypothesis, with the reason. Sweeps and a sensitivity
ranking ("what moves the answer most") are computed from the same evaluator.

## Privacy and security

- Keys only on the server; never logged (`server/log.ts` redacts keys and base64).
- Nothing is sent before the consent sheet lists what will be sent and to whom.
- Default model ids are the ones Meta states are not used to improve its products; the
  cheaper `-contributor` ids only by explicit choice.
- No photo is written to disk on the server; scans live in memory for at most 10 minutes.
- Muse Wonder never receives the photo. Muse Image receives it only to draw the cutaway of
  that object, which the consent sheet and the Privacy page say.
- Text in photos, sources and notes is treated as data in every prompt; model output is
  sanitised and rendered as text only (no `innerHTML`); links must be http(s).
- Uploads: MIME and magic bytes checked, size-capped, re-encoded. WAV headers checked.
  Per-IP rate limits, CORS allowlist, security headers, request ids.
- Profiles live in IndexedDB in the browser; export and delete-everything are one click.

## Testing

- `npm test`: 282 tests. Shared engine (firewall, calculator incl. injection attempts,
  quality, both sample runs end to end, eval metrics) and server (HTTP retries and circuit
  breaker, SAM adapter against the real wire sample from `@meta-sam/parser`, all nine
  connector parsers, the full HTTP API against a mock Meta server).
- `node scripts/e2e.cjs`: drives the built preview in headless Chromium at 1440 px, 390 px
  and in dark mode, runs both samples, visits every view, fails on console errors or
  horizontal overflow, and saves screenshots.
- `npm run e2e:live`: a live scan through the real browser UI and gateway (consent, SSE, SAM regions, profile) against the mock Meta API.
- `npm run eval`: accuracy, calibration, citation precision and unsupported-claim rate over
  a set of photos (live), or over the samples (offline harness check).
- `npm run models:probe`: tiny live calls per model role, to turn "documented" into
  "probed" in the capability table.

**Not verified in this build**: no call reached the real Meta Model API, an open-weight host
or the public connector APIs; the build sandbox could not reach them. The adapters follow
Meta's documentation and official cookbook code and are tested against a mock that mirrors
the documented request and response shapes. Run `npm run models:probe` with a key first.

## Deviations from the original brief

| Brief | Built | Why |
|---|---|---|
| Next.js front end, FastAPI back end | Vite + React SPA, Hono on Node | One TypeScript codebase shares the schemas and the engine between browser and server, and the app can also ship as a single-file offline preview |
| Postgres tables for objects, scans, claims | Stateless server; profiles in the browser's IndexedDB with export/import | Nothing personal is kept on a server by default. A database can be added behind the same schemas |
| Background job queue | In-memory job store with SSE replay | Enough for one server; documented as the point to add a queue |
| Live context feeds | Recall databases (CPSC, NHTSA) and product databases; live values only when a source states them | The firewall drops any "current" value nobody retrieved |
| Generated "inside view" | Muse Image cutaway of a generic object of the class, plus generic 3D exploded models for the samples | Labelled as generic everywhere; the person's photo is never sent to the image model |
