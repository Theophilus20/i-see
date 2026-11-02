# I SEE: standing rules for Muse Code

You are working on I SEE, a web app that examines a photographed object and builds a
profile in which every sentence says how it is known. These rules hold for every change.

## Never
- Never put a model call in the browser, or any key in client code. Keys live in `.env` on the server only. You do not have, and must not ask for, production keys.
- Never let a number reach the screen that `src/shared/calc.ts` did not compute.
- Never weaken `src/shared/firewall.ts` (quote checks, confidence caps, authoritative sources for safety, safety guards) to make a test pass. Fix the cause.
- Never label a model guess as “Seen” or “Cited”, a generated image as a photo of the person's object, or a sample run as live output.
- Never say a plant, fungus, food, medicine or chemical is safe to eat, take or touch. Never weaken that rule.
- Never write photos or scans to disk on the server, or log image bytes or keys.
- No OpenAI models in the stack. The `openai` npm package is used only as an HTTP client for Meta's OpenAI-compatible API.

## Where things are
- `src/shared/` is the contract and the engine: schemas (`schema.ts`, `model-io.ts`, `api.ts`), prompts (`prompts.ts`, versioned by `PROMPT_VERSION`), the firewall, the calculator, the assembler and the orchestrator. Change a schema here and both server and web follow.
- `server/` is the Hono gateway: Meta adapter (`server/meta/`), open-weight adapter, retrieval connectors, capability registry.
- `src/web/` is the React app. `fixtures/samples/` are hand-authored sample runs; `fixtures/specimens/` are rendered sample photos with exact masks.
- `docs/ARCHITECTURE.md`, `docs/MODELS.md`, `docs/DESIGN.md` explain the decisions. Read the relevant one before a structural change.

## Commands that must pass before you finish
```
npm run typecheck
npm test
npm run build
npm run build:preview && node scripts/e2e.cjs   # screenshots + overflow/console check
```
If you change a prompt, bump `PROMPT_VERSION` in `src/shared/prompts.ts`.
If you change model output schemas, keep them non-recursive (Meta rejects `$ref`) and run `npm test` (it checks `toStrictJsonSchema`).
If you add a connector, add a parser test with a recorded fixture in `tests/server/fixtures/`.

## Design rules (run /taste on any UI change)
- Meta Blue (`--action`) is for actions only. Evidence colours are teal (Seen), grape (Cited), tomato (Reasoned/Guess); every basis also has a glyph, a line pattern and a word. Never encode meaning by colour alone.
- Photography first: the plate is the hero. Binary surfaces: white for information, dark for the darkroom.
- Type: Atkinson Hyperlegible Next for UI, Literata (italic) for the voice of a profile, JetBrains Mono only for traces and code.
- No gradients for decoration, no glassmorphism, no emoji, no sparkle icons, no generic three-card feature grids, no “AI-powered” copy. Pill buttons, 8/20/24 px radii, 150/200 ms motion with `cubic-bezier(0.2,0,0,1)`, respect reduced motion.
- 16 px minimum side gutter on phones, no horizontal scroll, visible 3 px focus ring, every control reachable by keyboard.

## Writing in the interface
Plain words, short sentences, no hype. Say what is known and how. “Unknown” is a good answer.
