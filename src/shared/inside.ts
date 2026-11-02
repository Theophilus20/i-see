/**
 * The inside view: what each part does and how it works, and how things flow.
 *
 * Model-written, so it is treated exactly like the rest of the profile: every part and
 * every flow becomes a finding and goes through the firewall (quotes checked, confidence
 * capped, unsafe assurances replaced, phantom regions and sources removed).
 */
import type { Category, Hazard } from './epistemics';
import { runFirewall } from './firewall';
import type { InsideDraft } from './model-io';
import type { Finding, Inside, Region, Source } from './schema';
import { clamp01, sanitizeText } from './text';

export function assembleInside(input: { draft: InsideDraft; regions: Region[]; sources: Source[]; category: Category; hazards: Hazard[]; now: string }): Inside {
  const { draft } = input;
  const findings: Finding[] = [];
  const mk = (id: string, section: Finding['section'], text: string, c: InsideDraft['groups'][number]['parts'][number] | InsideDraft['flows'][number]): Finding => ({
    id,
    section,
    text,
    basis: c.basis ?? 'inferred',
    confidence: c.confidence == null ? null : clamp01(c.confidence),
    regionIds: (c.regionIds ?? []).map(String),
    sourceIds: (c.sourceIds ?? []).map(String),
    quote: c.quote ?? null,
    verification: { status: 'unverified', notes: [] },
    recheckAfter: null,
    flags: [],
    origin: 'model',
    disputed: false,
    note: null,
  });

  const groups = (draft.groups ?? []).slice(0, 8).map((g, gi) => ({
    id: `g${gi + 1}`,
    name: sanitizeText(g.name, 100),
    role: sanitizeText(g.role, 300),
    parts: (g.parts ?? []).slice(0, 8).map((p, pi) => {
      const id = `i${gi + 1}-${pi + 1}`;
      const name = sanitizeText(p.name, 100);
      findings.push(mk(id, 'parts', `${name}: ${sanitizeText(p.what, 240)} ${sanitizeText(p.how, 500)}`.trim(), { ...p, regionIds: p.regionId ? [p.regionId, ...(p.regionIds ?? [])] : p.regionIds }));
      return { id, name, what: sanitizeText(p.what, 240), how: sanitizeText(p.how, 500), regionId: p.regionId, visible: !!p.visibleInPhoto, findingId: id };
    }),
  }));

  const flows = (draft.flows ?? [])
    .slice(0, 3)
    .map((f, fi) => {
      const id = `flow${fi + 1}`;
      const steps = (f.steps ?? []).slice(0, 10).map((s) => ({ label: sanitizeText(s.label, 60), detail: sanitizeText(s.detail, 240) }));
      findings.push(mk(id, 'operation', `${sanitizeText(f.title, 140)}: ${steps.map((s) => s.label).join(', then ')}. ${sanitizeText(f.summary, 400)}`, f));
      return { id, title: sanitizeText(f.title, 140), summary: sanitizeText(f.summary, 400), steps, findingId: id };
    })
    .filter((f) => f.steps.length >= 2);

  const checked = runFirewall({ findings, regions: input.regions, sources: input.sources, category: input.category, hazards: input.hazards, now: input.now });
  const kept = new Map(checked.findings.map((f) => [f.id, f]));
  const regionIds = new Set(input.regions.map((r) => r.id));

  return {
    kind: draft.kind,
    intro: sanitizeText(draft.intro, 600),
    groups: groups
      .map((g) => ({
        ...g,
        parts: g.parts
          .filter((p) => kept.has(p.findingId))
          .map((p) => {
            const f = kept.get(p.findingId)!;
            // A safety rule replaced this text: show the replacement, not the model's wording.
            if (f.verification.status === 'guarded') return { ...p, what: f.text, how: '', regionId: null };
            const regionId = p.regionId && regionIds.has(p.regionId) ? p.regionId : null;
            return { ...p, regionId, visible: p.visible && !!regionId };
          }),
      }))
      .filter((g) => g.parts.length),
    flows: flows.filter((f) => kept.has(f.findingId) && kept.get(f.findingId)!.verification.status !== 'guarded'),
    findings: checked.findings,
    brief: sanitizeText(draft.illustrationBrief, 600),
    createdAt: input.now,
  };
}
