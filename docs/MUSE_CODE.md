# Continuing I SEE with Muse Code

I SEE was built in this session by Claude. The repository is set up so Meta's Muse Code
agent can carry it forward safely: its standing rules are in `.agents/AGENTS.md`, which
Muse Code loads automatically once you trust the workspace.

## Set up

```bash
curl -fsSL https://dev.meta.ai/install.sh | sh        # macOS / Linux
# Windows PowerShell: irm https://dev.meta.ai/install.ps1 | iex
cd i-see
npm install
muse                                                   # interactive; trust the workspace when asked
```

Do not give Muse Code your production `MODEL_API_KEY`. It does not need one: the test suite
runs against a mock of the Meta Model API (`tests/server/mock-meta.ts`), and sample runs need
no key at all. If you want the agent to call models during development, give it a separate,
low-limit development key in its own environment, never the server's `.env`.

## Useful headless runs

Each of these is self-contained and ends with the checks in `AGENTS.md`.

```bash
# Add a retrieval connector
muse exec "Add a retrieval connector for the Smithsonian Open Access API in server/retrieval/connectors, following the pattern of met.ts. Pick it for artifact and mineral categories. Tier 3. Add a parser test with a recorded fixture. Run npm run typecheck and npm test."

# A third sample run
muse exec "Add a third sample run in fixtures/samples for a houseplant (aloe vera) whose profile demonstrates the plant safety guard: one draft finding claims the gel is safe to eat and must be replaced by the firewall. Only cite text you can quote verbatim from a real page; add the page excerpts to the source snippet. Extend tests/shared/samples.test.ts. Render a specimen photo with scripts/specimens."

# Translate the interface
muse exec "Extract every user-facing string in src/web into src/web/i18n/en.ts and add fr.ts. Do not translate model output. Keep the evidence words (Seen, Cited, Reasoned, Guess, Unknown, Yours) consistent across the app."

# Review a UI change against the design rules
muse exec "/taste Review src/web/pages/Workspace.tsx and src/web/styles/workspace.css against .agents/AGENTS.md design rules and fix what does not meet them. Then run npm run build:preview && node scripts/e2e.cjs and look at the screenshots."
```

## Long tasks with a goal

```bash
muse
/goal Every page passes node scripts/e2e.cjs at 1440, 390 and dark mode, npm test is green, and no file in src/web uses a hex colour outside src/web/styles/tokens.css.
```

## What to check in review

- The diff does not touch `src/shared/firewall.ts` or `src/shared/calc.ts` without a matching test.
- Any prompt change bumps `PROMPT_VERSION`.
- No key, base64 image or personal data in logs, fixtures or commits.
