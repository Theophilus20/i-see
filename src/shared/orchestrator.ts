/**
 * The scan pipeline.
 *
 *   intake → quality → identify → (segment ∥ retrieve) → compose → reconcile → resolve
 *
 * Provider-neutral: it calls ModelTasks and a Retriever and emits ScanEvents. The
 * server runs it with Meta Model API and open-weight adapters; the browser preview
 * runs it with sample tasks. Every stage reports which model did the work, how long
 * it took and what it cost, and a failing stage degrades the profile instead of
 * hiding the failure.
 */
import type { EscalationRequest, ScanEvent, ScanRequest } from './api';
import { applyDecision, applyResolve, assembleProfile, candidatesFrom, identityStatus, isAmbiguous, regionsFromPointers } from './assemble';
import type { IdentifyOutput, ProfileCoreDraft, ProfileExtrasDraft } from './model-io';
import { mergeQuality, assessPixels } from './quality';
import type { Candidate, NextShot, Profile, QualityReport, Region, SecondOpinion, Source, StageId, Trace, TraceStage, Usage, View } from './schema';
import type { CallCtx, ImagePayload, ModelTasks, Retriever, RetrieveQuery, Tracked } from './tasks';
import { normalizeForMatch, sanitizeText, scrubProviderNames } from './text';
import { PROMPT_VERSION } from './prompts';
import { kindKey, planForObject } from './bodyplans';

export const STAGE_LABEL: Record<StageId, string> = {
  intake: 'Preparing your photo',
  quality: 'Checking the photo',
  identify: 'Recognising the object',
  segment: 'Finding its parts',
  retrieve: 'Looking it up',
  compose: 'Writing about it',
  reconcile: 'Double-checking the facts',
  resolve: 'Settling any doubt',
};

export interface OrchestratorDeps {
  /** Tasks for the chosen route. */
  tasks: ModelTasks;
  /** A second route: the independent opinion for `consensus`, or the hosted fallback for `local-first`. */
  secondary?: ModelTasks | null;
  retriever: Retriever;
  emit: (e: ScanEvent) => void;
  /** Asked before anything leaves the device on the local-first route. Resolves true if the person agrees. */
  requestEscalation?: (req: EscalationRequest) => Promise<boolean>;
  now?: () => string;
  newId?: () => string;
  signal?: AbortSignal;
  mode?: Trace['mode'];
}

class Aborted extends Error {}

function randomId(): string {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

const sumUsage = (us: Array<Usage | null>): number | null => {
  const costs = us.filter((u): u is Usage => !!u && u.costUsd != null).map((u) => u.costUsd!);
  return costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) * 10000) / 10000 : null;
};

/** Short noun phrases only: SAM is prompted with these, so nothing else gets through. */
export function cleanConcept(phrase: string): string | null {
  const s = sanitizeText(phrase, 60)
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    // A command slipped in ("segment the handle"): keep the thing, drop the verb.
    .replace(/^(?:please\s+)?(?:segment|outline|find|detect|show|mark|highlight|select|identify|locate)\s+(?:the\s+|a\s+|an\s+|all\s+)?/, '')
    .replace(/^(?:the|a|an)\s+/, '');
  if (!s || s.split(' ').length > 5) return null;
  return s;
}

/** Part names as written, minus commands, duplicates and the background. */
export function partLabels(phrases: string[], max = 12): string[] {
  const out: string[] = [];
  phrases.forEach((p, i) => {
    const c = sanitizeText(p, 120)
      .replace(/^(?:please\s+)?(?:segment|outline|find|detect|show|mark|highlight|select|identify|locate)\s+(?:the\s+|a\s+|an\s+|all\s+)?/i, '')
      .replace(/[\s!?.,;:]+$/, '')
      .trim();
    if (!c || (i > 0 && BACKGROUND.test(c.toLowerCase()))) return;
    if (!out.some((o) => o.toLowerCase() === c.toLowerCase())) out.push(c);
  });
  return out.slice(0, max);
}

/** What surrounds the object is not one of its parts. */
const BACKGROUND = /\b(?:background|backdrop|surface|tabletop|table top|floor|wall|desk|ground|sky|shadow|reflection|surroundings|scene)\b/;

/**
 * The phrases sent for outlining. SAM outlines every instance of a phrase and does not
 * understand "left" or "right", so "left earcup" and "right earcup" become one "earcup"
 * request, and the instances are named by where they are in the photo afterwards.
 * Background phrases are dropped, except when the object itself is the first phrase.
 */
export function segmentConcepts(phrases: string[], max = 8): string[] {
  const out: string[] = [];
  phrases.forEach((p, i) => {
    let c = cleanConcept(p);
    if (!c) return;
    if (i > 0 && BACKGROUND.test(c)) return;
    c = c.replace(/\b(?:left|right)(?:-hand)?\s+/g, '').replace(/\s+(?:on the )?(?:left|right)$/, '').trim();
    if (c && !out.includes(c)) out.push(c);
  });
  return out.slice(0, max);
}

export function compareOpinions(mine: Candidate[], theirs: IdentifyOutput, model: string, provider: string, now: string): SecondOpinion {
  const top = mine.find((c) => !c.eliminated);
  const other = theirs.candidates[0];
  const a = normalizeForMatch(top?.name ?? '');
  const b = normalizeForMatch(other?.name ?? '');
  const words = (s: string) => new Set(s.split(' ').filter((w) => w.length > 2));
  const wa = words(a);
  const wb = words(b);
  const overlap = [...wa].filter((w) => wb.has(w)).length / Math.max(1, Math.min(wa.size, wb.size));
  const agreement: SecondOpinion['agreement'] = a && a === b ? 'agrees' : overlap >= 0.5 ? 'partly' : 'differs';
  const disagreements: SecondOpinion['disagreements'] = [];
  if (agreement !== 'agrees') disagreements.push({ topic: 'What it is', mine: sanitizeText(top?.name ?? 'Unknown', 240), theirs: sanitizeText(other?.name ?? 'Unknown', 240) });
  if (top && other && top.category !== other.category) disagreements.push({ topic: 'Kind of thing', mine: top.category, theirs: other.category });
  return {
    model,
    provider,
    agreement,
    topCandidate: sanitizeText(other?.name ?? 'No answer', 160),
    notes: theirs.candidates.slice(1, 3).map((c) => `Also considered: ${sanitizeText(c.name, 120)}`),
    disagreements,
    ranAt: now,
  };
}

export async function runScan(req: ScanRequest, deps: OrchestratorDeps): Promise<Profile | null> {
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? randomId;
  const runId = newId();
  const startedAt = now();
  const stages: TraceStage[] = [];
  const models: Trace['models'] = [];
  const usages: Array<Usage | null> = [];
  let active = deps.tasks;
  let route = req.route;

  const ctx = (): CallCtx => ({ signal: deps.signal, language: req.language, privacyTier: req.privacyTier, route, runId });
  const checkAbort = () => {
    if (deps.signal?.aborted) throw new Aborted('cancelled');
  };
  const start = (id: StageId, model: string | null = null, provider: string | null = null) =>
    deps.emit({ type: 'stage', id, label: STAGE_LABEL[id], status: 'start', model, provider, ms: null, note: null });
  const finish = (id: StageId, status: TraceStage['status'], t: Pick<Tracked<unknown>, 'model' | 'provider' | 'ms' | 'usage'> | null, note: string | null = null, role?: string) => {
    note = note ? scrubProviderNames(note) : note;
    stages.push({ id, label: STAGE_LABEL[id], model: t?.model ?? null, provider: t?.provider ?? null, status, ms: t?.ms ?? null, note: note ? sanitizeText(note, 300) : null, usage: t?.usage ?? null });
    if (t) {
      usages.push(t.usage);
      if (role && !models.some((m) => m.role === role && m.model === t.model)) models.push({ role, model: t.model, provider: t.provider, promptVersion: PROMPT_VERSION });
    }
    deps.emit({ type: 'stage', id, label: STAGE_LABEL[id], status: status === 'done' ? 'done' : status === 'skipped' ? 'skip' : 'error', model: t?.model ?? null, provider: t?.provider ?? null, ms: t?.ms ?? null, note });
  };
  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

  const views: ImagePayload[] = req.views.map((v) => ({ mime: v.mime, base64: v.base64, width: v.width, height: v.height, label: v.label }));
  const viewMeta: View[] = req.views.map((v, index) => ({
    index,
    width: v.width,
    height: v.height,
    mime: v.mime,
    label: v.label,
    bytes: Math.floor((v.base64.length * 3) / 4),
  }));

  try {
    // 1. Intake
    start('intake');
    finish('intake', 'done', null, `${views.length === 1 ? 'Your photo is' : `${views.length} photos are`} ready. Location data was removed on your device.`);

    // 2. Quality (device measurements; the model's view is merged after identify)
    start('quality');
    const v0 = views[0]!;
    let quality: QualityReport =
      req.clientQuality && req.clientQuality.sharpness != null && req.clientQuality.brightness != null
        ? assessPixels({ sharpness: req.clientQuality.sharpness, brightness: req.clientQuality.brightness, clipped: req.clientQuality.clipped ?? 0 }, v0.width, v0.height)
        : { adequate: true, issues: [], advice: [], metrics: null };
    finish('quality', 'done', null, quality.issues.length ? quality.issues.map((i) => i.note).join(' ') : 'Sharp and well lit.');
    deps.emit({ type: 'quality', report: quality });
    checkAbort();

    // 3. Identify (and, on the consensus route, an independent second opinion in parallel)
    const identifyInput = { views, hint: req.hint, prior: req.prior, depth: req.depth, clientQuality: req.clientQuality };
    start('identify');
    const second =
      route === 'consensus' && deps.secondary ? deps.secondary.secondOpinion(identifyInput, { ...ctx(), route: 'private' }).catch((e: unknown) => e as Error) : null;
    let identified: Tracked<IdentifyOutput>;
    try {
      identified = await active.identify(identifyInput, ctx());
    } catch (e) {
      void errText(e);
      const code = (e as { code?: unknown })?.code;
      const unreachable = code === 'network' || code === 'circuit_open';
      if (unreachable) {
        // Nothing was wrong with the photo: the server could not get to the analysis service.
        finish('identify', 'error', null, 'I SEE could not reach its analysis service. Nothing is wrong with your photo.');
        deps.emit({ type: 'error', code: 'service_unreachable', message: 'The analysis service could not be reached. Nothing was saved.', retryable: true, stage: 'identify' });
      } else {
        finish('identify', 'error', null, 'The photo could not be read this time.');
        deps.emit({ type: 'error', code: 'identify_failed', message: 'The photo could not be analysed. Nothing was saved.', retryable: true, stage: 'identify' });
      }
      return null;
    }
    let identify = identified.value;
    let candidates = candidatesFrom(identify.candidates, identify.primary.category);

    // Local-first: if the on-device-class model is unsure, ask before sending anything to a hosted model.
    if (route === 'local-first' && deps.secondary && deps.requestEscalation && isAmbiguous(candidates)) {
      const request: EscalationRequest = {
        id: newId(),
        reason: `The first look on your computer is unsure (${candidates[0] ? `${Math.round(candidates[0].likelihood * 100)}% on its best guess` : 'no candidates'}). The standard analysis may do better.`,
        model: 'The standard analysis',
        preview: {
          text: `${views.length} photo${views.length === 1 ? '' : 's'}${req.hint ? ` and your note: "${req.hint}"` : ''}`,
          imageCount: views.length,
          bytes: viewMeta.reduce((a, v) => a + (v.bytes ?? 0), 0),
        },
      };
      deps.emit({ type: 'escalation', request });
      if (await deps.requestEscalation(request)) {
        finish('identify', 'done', identified, 'First look on your computer; you approved the standard analysis.', 'identify (local)');
        start('identify');
        active = deps.secondary;
        route = 'hosted';
        identified = await active.identify(identifyInput, ctx());
        identify = identified.value;
        candidates = candidatesFrom(identify.candidates, identify.primary.category);
      }
    }
    {
      const top = identify.candidates[0]?.name ?? 'something we are not sure of yet';
      const others = identify.candidates.length - 1;
      const words = identify.textRead.length;
      finish(
        'identify',
        'done',
        identified,
        `Best match: ${top}.${others > 0 ? ` ${others === 1 ? 'One other possibility is' : `${others} other possibilities are`} kept in mind.` : ''}${words ? ` Read ${words === 1 ? 'some writing' : `${words} bits of writing`} on it.` : ''}`,
        'identify',
      );
    }
    quality = mergeQuality(quality, identify.quality);
    if (!identify.quality.adequate) deps.emit({ type: 'quality', report: quality });
    deps.emit({ type: 'candidates', candidates, status: identityStatus(candidates) });
    checkAbort();

    // 4. Segment ∥ retrieve
    const concepts = segmentConcepts(identify.concepts.map((c) => c.phrase));
    // The full part names, for locating and labelling (left and right kept apart here).
    const labels = partLabels(identify.concepts.map((c) => c.phrase));
    const textRead = identify.textRead.map((t) => t.text).filter(Boolean).slice(0, 8);
    const queries: RetrieveQuery[] = identify.retrievalQueries
      .map((q) => ({ query: sanitizeText(q.query, 120), intent: q.intent }))
      .filter((q) => q.query)
      .slice(0, 6);
    if (!queries.length && candidates[0]) queries.push({ query: candidates[0].name, intent: 'identify' });

    start('segment');
    start('retrieve');
    // Close candidates (a fancy rat or a fancy mouse?) are settled with web research on what tells
    // them apart, checked against the photo, alongside the outlining and the look-up.
    const close = candidates.filter((c) => !c.eliminated).slice(0, 3);
    const deciding =
      active.decide && close.length > 1 && isAmbiguous(candidates)
        ? active
            .decide(
              {
                candidates: close.map((c) => ({ name: c.name, likelihood: c.likelihood, evidenceFor: c.evidenceFor, evidenceAgainst: c.evidenceAgainst })),
                observations: identify.primary.description,
                textRead: identify.textRead.map((t) => t.text).filter(Boolean).slice(0, 8),
                view: v0,
              },
              ctx(),
            )
            .catch((e: unknown) => e as Error)
        : Promise.resolve(null);
    // The parts this kind of object really has, looked up on the web first, so every visible one
    // is found and outlined under its real name (not only the few noticed at first glance).
    const objectName = candidates[0]?.name ?? null;
    const budget = (ms: number) => {
      const t = AbortSignal.timeout(ms);
      return deps.signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([deps.signal, t]) : t;
    };
    const researching =
      active.researchParts && objectName
        ? active.researchParts({ object: objectName, category: identify.primary.category }, { ...ctx(), signal: budget(55_000) }).catch((e: unknown) => e as Error)
        : Promise.resolve(null);
    // The built-in body-plan reference: the correct names for this kind of thing's parts.
    const plan = objectName ? planForObject({ displayName: objectName, category: identify.primary.category, subcategory: identify.primary.subcategory, candidates, summary: identify.primary.description }) : null;
    const segmenting = (async () => {
      const pr = await researching;
      const seen = labels.map((l) => normalizeForMatch(l).replace(/s\b/g, ''));
      const fresh = (names: string[]) =>
        names.filter((n) => {
          const k = normalizeForMatch(n).replace(/s\b/g, '');
          const dup = !k || seen.some((x) => x === k || x.includes(k) || k.includes(x));
          if (!dup) seen.push(k);
          return !dup;
        });
      // Only what was noticed in this photo is looked for by name; every other visible part is
      // found by looking. The reference parts and the web research supply correct names only:
      // handed a list of parts to find, vision models "find" parts that usually go with the
      // object even when they are not in the photo (a car's boot in a photo of its front).
      const planNames = fresh(plan?.external ?? []);
      const researchedNames = fresh(pr && !(pr instanceof Error) ? pr.value.names : []);
      const all = partLabels(labels, 20);
      if (!concepts.length && all.length < 1) return new Error('No visible parts were proposed for outlining.');
      // What this person has taught about this kind of object (from the Train game).
      const kind = objectName ? kindKey({ displayName: objectName, category: identify.primary.category, subcategory: identify.primary.subcategory, candidates, summary: identify.primary.description }) : '';
      const taught = (req.taught ?? []).filter((t) => t.kind === kind).slice(-20).map(({ from, to }) => ({ from, to }));
      const vocabulary = [...new Set([...taught.map((t) => t.to), ...(plan?.external ?? []), ...planNames, ...researchedNames])].slice(0, 40);
      return active.segment({ view: v0, viewIndex: 0, concepts: concepts.length ? concepts : all.slice(0, 8), labels: all, object: objectName, vocabulary, taught, depth: req.depth }, ctx());
    })().catch((e: unknown) => e as Error);
    const [seg, ret, decided, researched] = await Promise.all([
      segmenting,
      deps.retriever.retrieve(queries, { ...ctx(), category: identify.primary.category, textRead }).catch((e: unknown) => e as Error),
      deciding,
      researching,
    ]);

    let regions: Region[];
    if (seg instanceof Error || seg.value.regions.length === 0) {
      regions = regionsFromPointers(identify, v0);
      const why = seg instanceof Error ? 'Exact outlines could not be drawn this time.' : 'No clear parts could be marked.';
      finish('segment', regions.length ? 'done' : 'error', seg instanceof Error ? null : seg, `${why} ${regions.length ? `Showing roughly where ${regions.length} parts are instead.` : ''}`.trim(), 'segment');
    } else {
      regions = seg.value.regions;
      const masks = regions.filter((r) => r.kind === 'mask').length;
      const looked = researched && !(researched instanceof Error) && researched.value.names.length ? `Looked up the parts a ${objectName} has, then marked ` : 'Marked ';
      finish('segment', 'done', seg, masks ? `${looked}${masks} part${masks === 1 ? '' : 's'} on your photo.` : 'No parts could be marked clearly on this photo.', 'segment');
    }
    deps.emit({ type: 'regions', regions });

    let sources: Source[] = [];
    if (ret instanceof Error) {
      finish('retrieve', 'error', null, 'Nothing could be looked up this time, so this is based on the photo alone.');
    } else {
      sources = ret.sources.slice(0, 40);
      // Keep only sources that are really about this object (a search for "olive oil" can bring back "Art").
      let dropped = 0;
      if (sources.length) {
        try {
          const screened = await active.screenSources(
            {
              object: candidates[0]?.name ?? identify.primary.description.slice(0, 120),
              candidates: candidates.slice(0, 4).map((c) => c.name),
              textRead,
              sources: sources.map((x) => ({ id: x.id, title: x.title, snippet: x.snippet })),
            },
            ctx(),
          );
          const off = new Set(screened.value.sources.filter((x) => !x.relevant).map((x) => x.id));
          if (off.size < sources.length || sources.length === 0) {
            dropped = off.size;
            sources = sources.filter((x) => !off.has(x.id));
          } else {
            dropped = sources.length;
            sources = [];
          }
        } catch {
          /* unscreened sources still pass the quote checks later */
        }
        // Renumber so ids stay s1, s2, … in order.
        sources = sources.map((x, i) => ({ ...x, id: `s${i + 1}` }));
      }
      const someFailed = ret.notes.some((n) => /could not|failed|timed out|unavailable|error/i.test(n));
      finish(
        'retrieve',
        sources.length ? 'done' : 'skipped',
        null,
        sources.length
          ? `Found ${sources.length} useful page${sources.length === 1 ? '' : 's'} about it${dropped ? ` and left out ${dropped} that ${dropped === 1 ? 'was' : 'were'} about something else` : ''}.${someFailed ? ' A few sites did not answer.' : ''}`
          : 'No pages about this exact object were found, so this is based on the photo.',
      );
    }
    // The pages read for the part names are sources too.
    if (researched && !(researched instanceof Error)) {
      usages.push(researched.usage);
      if (!models.some((m) => m.role === 'parts' && m.model === researched.model)) models.push({ role: 'parts', model: researched.model, provider: researched.provider, promptVersion: PROMPT_VERSION });
      const seen = new Set(sources.map((x) => x.url));
      for (const x of researched.value.sources) {
        if (seen.has(x.url) || sources.length >= 40) continue;
        seen.add(x.url);
        sources.push({ ...x, id: `s${sources.length + 1}` });
      }
    } else if (researched instanceof Error) void errText(researched);
    // Apply the deep check: the pages it read become sources, and a clear answer goes to the top.
    if (decided && !(decided instanceof Error)) {
      const seen = new Set(sources.map((x) => x.url));
      for (const x of decided.value.sources) {
        if (seen.has(x.url) || sources.length >= 40) continue;
        seen.add(x.url);
        sources.push({ ...x, id: `s${sources.length + 1}` });
      }
      const names = close.map((c) => c.name);
      const applied = applyDecision(candidates, decided.value.decision);
      let note: string;
      if (applied.winner) {
        candidates = applied.candidates;
        // Compose writes about the settled identity.
        identify = {
          ...identify,
          candidates: candidates.map((c) => ({ name: c.name, category: c.category, likelihood: c.likelihood, evidenceFor: c.evidenceFor, evidenceAgainst: c.evidenceAgainst, missing: c.missing })),
        };
        deps.emit({ type: 'candidates', candidates, status: identityStatus(candidates) });
        note = `Checked what tells ${names.join(' from ')} apart: it is ${applied.winner.name}. ${sanitizeText(decided.value.decision.reason, 240)}`;
      } else note = `Checked what tells ${names.join(' from ')} apart, but this photo does not show enough to be sure.`;
      // The note joins the look-up step's own.
      usages.push(decided.usage);
      if (!models.some((m) => m.role === 'decide' && m.model === decided.model)) models.push({ role: 'decide', model: decided.model, provider: decided.provider, promptVersion: PROMPT_VERSION });
      const rs = stages.find((x) => x.id === 'retrieve');
      const combined = sanitizeText(scrubProviderNames(`${rs?.note ?? ''} ${note}`.trim()), 300);
      if (rs) {
        rs.note = combined;
        if (rs.status === 'skipped' && sources.length) rs.status = 'done';
      }
      deps.emit({ type: 'stage', id: 'retrieve', label: STAGE_LABEL.retrieve, status: rs?.status === 'error' ? 'error' : 'done', model: rs?.model ?? null, provider: rs?.provider ?? null, ms: rs?.ms ?? null, note: combined });
    } else if (decided instanceof Error) void errText(decided);
    deps.emit({ type: 'sources', sources });
    checkAbort();

    // 5. Compose
    start('compose');
    let core: ProfileCoreDraft | null = null;
    let extras: ProfileExtrasDraft | null = null;
    try {
      const composed = await active.compose({ views, identify, regions, sources, hint: req.hint, prior: req.prior }, ctx());
      core = composed.value.core;
      extras = composed.value.extras;
      finish('compose', 'done', composed, null, 'compose');
    } catch (e) {
      finish('compose', 'error', null, 'The full write-up could not be finished this time. Showing what could be seen.');
      void errText(e);
    }
    checkAbort();

    // 6. Resolve: only when there is doubt worth spending a reasoning model on.
    let nextShot: NextShot | null = null;
    const resolveNotes: string[] = [];
    const extraOpenQuestions: string[] = [];
    if (isAmbiguous(candidates) && candidates.length > 1) {
      start('resolve');
      try {
        const resolved = await active.resolve(
          {
            candidates: candidates.map((c) => ({ name: c.name, likelihood: c.likelihood, evidenceFor: c.evidenceFor, evidenceAgainst: c.evidenceAgainst, missing: c.missing })),
            observations: identify.primary.description,
            textRead,
            sources: sources.slice(0, 12).map((s) => ({ id: s.id, title: s.title, snippet: s.snippet.slice(0, 900) })),
          },
          ctx(),
        );
        const applied = applyResolve(candidates, resolved.value);
        candidates = applied.candidates;
        nextShot = applied.nextShot;
        resolveNotes.push(...applied.notes);
        extraOpenQuestions.push(...resolved.value.researchQuestions.slice(0, 3), ...resolved.value.alternativeExplanations.slice(0, 2).map((a) => `Not yet ruled out: ${a}`));
        finish('resolve', 'done', resolved, nextShot ? `To be sure: ${nextShot.instruction}` : 'It is now clear which one it is.', 'resolve');
        deps.emit({ type: 'candidates', candidates, status: identityStatus(candidates) });
      } catch (e) {
        finish('resolve', 'error', null, 'The doubt could not be settled this time.');
        void errText(e);
      }
    } else {
      stages.push({ id: 'resolve', label: STAGE_LABEL.resolve, model: null, provider: null, status: 'skipped', ms: null, note: 'Not needed: one candidate is clearly ahead.', usage: null });
      deps.emit({ type: 'stage', id: 'resolve', label: STAGE_LABEL.resolve, status: 'skip', model: null, provider: null, ms: null, note: 'Not needed: one candidate is clearly ahead.' });
    }

    // Second opinion lands whenever it finishes.
    let secondOpinion: SecondOpinion | null = null;
    if (second) {
      const s = await second;
      if (s instanceof Error) resolveNotes.push(`The second opinion failed: ${errText(s)}`);
      else {
        secondOpinion = compareOpinions(candidates, s.value, s.model, s.provider, now());
        usages.push(s.usage);
        models.push({ role: 'second opinion', model: s.model, provider: s.provider, promptVersion: PROMPT_VERSION });
      }
    }

    // 7. Reconcile: the firewall
    start('reconcile');
    const t0 = Date.now();
    const profile = assembleProfile({
      profileId: newId(),
      scanId: runId,
      now: now(),
      views: viewMeta,
      identify,
      candidates,
      nextShot,
      secondOpinion,
      quality,
      regions,
      sources,
      core,
      extras,
      resolveNotes,
      extraOpenQuestions,
      trace: { runId, mode: deps.mode ?? 'live', route, startedAt, stages, models, costUsd: sumUsage(usages), language: req.language },
    });
    const fw = profile.trace.firewall;
    const reconcileNote = [
      `Checked ${fw.checked} fact${fw.checked === 1 ? '' : 's'}.`,
      fw.citationsClaimed ? `${fw.citationsVerified} of ${fw.citationsClaimed} quotes match their page word for word.` : '',
      fw.downgraded ? `${fw.downgraded} marked as less certain.` : '',
      fw.dropped ? `${fw.dropped} left out.` : '',
      fw.guarded ? `${fw.guarded} safety note${fw.guarded === 1 ? '' : 's'} added.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const rec: TraceStage = { id: 'reconcile', label: STAGE_LABEL.reconcile, model: null, provider: 'I SEE', status: 'done', ms: Date.now() - t0, note: reconcileNote, usage: null };
    // Keep stage order readable: reconcile before resolve in the trace.
    const resolveAt = profile.trace.stages.findIndex((s) => s.id === 'resolve');
    if (resolveAt >= 0) profile.trace.stages.splice(resolveAt, 0, rec);
    else profile.trace.stages.push(rec);
    deps.emit({ type: 'stage', id: 'reconcile', label: STAGE_LABEL.reconcile, status: 'done', model: null, provider: 'I SEE', ms: rec.ms, note: reconcileNote });

    deps.emit({ type: 'profile', profile });
    deps.emit({ type: 'done' });
    return profile;
  } catch (e) {
    if (e instanceof Aborted || deps.signal?.aborted) {
      deps.emit({ type: 'error', code: 'cancelled', message: 'Stopped. Nothing was saved.', retryable: true, stage: null });
      return null;
    }
    deps.emit({ type: 'error', code: 'internal', message: 'Something went wrong while building the profile.', retryable: true, stage: null });
    throw e;
  }
}
