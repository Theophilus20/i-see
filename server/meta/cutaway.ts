/**
 * A cutaway that matches the person's object, labelled accurately.
 *
 * Image models paint convincing pictures but are poor at writing labels and drawing leader
 * lines to the right place (text is the weakest part of every image model). So the picture
 * and the labels are made by the tools that are good at each:
 *
 *   1. Draw. Muse Image paints only the inside, from the photo itself (same pose and framing):
 *      for a living thing its skeleton and organs with no skin or fur, for a machine its inner
 *      parts with the casing taken away. It looks up real references first. Never any text.
 *   2. Check the drawing. Muse Spark compares it with the photo and with how this kind of
 *      object really is inside. If something is wrong, Muse Image corrects only that, keeping
 *      everything else; up to twice, keeping whichever version checks best.
 *   3. Find each part in the drawing. Muse Spark locates every part that is drawn, SAM 3.1
 *      outlines it, and Muse Spark checks each outline against its name. I SEE then shows the
 *      labels itself, crisp and spelled exactly, each pointing at the part that was found.
 */
import sharp from 'sharp';
import { CutawayReviewSchema, type CutawayReview } from '../../src/shared/model-io';
import { CUTAWAY_REVIEW_SYSTEM, cutawayReviewUser } from '../../src/shared/prompts';
import type { ProfileDigest, Region } from '../../src/shared/schema';
import type { CallCtx, ImagePayload } from '../../src/shared/tasks';
import { normalizeForMatch, sanitizeText } from '../../src/shared/text';
import { log } from '../log';
import { chatStructured } from './structured';
import { nameByMarks, scaleRegions, workingCopy } from './label';
import { labelsFor, planForObject, planKeyword, referenceQueries } from '../../src/shared/bodyplans';
import { referencePictures, type ReferencePicture } from '../retrieval/references';
import type { MetaTasks } from './tasks';
import { sparkModel, type Config } from '../config';

type Img = { mime: 'image/jpeg'; base64: string; width: number; height: number };

export interface CutawayResult {
  /** The drawing, the same size as the photo, with no text in it. */
  image: Img;
  /** The same drawing (kept for older clients). */
  clean: Img | null;
  /** Each part found in the drawing: outline and anchor for the label. */
  regions: Region[];
  review: { matchesPhoto: number; accuracy: number; problems: string[]; redrawn: boolean } | null;
  labels: { expected: string[]; correct: string[]; problems: string[]; fixed: boolean } | null;
  diagnostics: string[];
}

/**
 * The drawing at full quality, in exactly the photo's shape (so it lines up with it) but never
 * smaller than the model drew it: a small photo does not make a small, soft drawing.
 */
async function toJpeg(base64: string, size: { width: number; height: number } | null, max = 2400): Promise<ImagePayload> {
  const src = sharp(Buffer.from(base64, 'base64'));
  const meta = await src.metadata();
  const long = Math.min(max, Math.max(1600, meta.width ?? 0, meta.height ?? 0));
  let img = src.flatten({ background: '#ffffff' });
  if (size) {
    const r = size.width / Math.max(1, size.height);
    const width = r >= 1 ? long : Math.round(long * r);
    const height = r >= 1 ? Math.round(long / r) : long;
    img = img.resize({ width, height, fit: 'fill', kernel: 'lanczos3' });
  } else img = img.resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true });
  const { data, info } = await img.jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer({ resolveWithObject: true });
  return { mime: 'image/jpeg', base64: data.toString('base64'), width: info.width, height: info.height, label: null };
}

const plain = (v: ImagePayload): Img => ({ mime: 'image/jpeg', base64: v.base64, width: v.width, height: v.height });
const clamp5 = (n: number) => Math.max(1, Math.min(5, Math.round(Number(n) || 0)));

export async function makeCutaway(
  meta: MetaTasks,
  cfg: Config,
  input: { digest: ProfileDigest; inside: { kind: string; brief: string; parts: string[] } | null; photo: ImagePayload | null; style?: 'cutaway' },
  ctx: CallCtx,
  fetchImpl: typeof fetch = fetch,
): Promise<CutawayResult> {
  const object = input.digest.displayName;
  const diagnostics: string[] = [];
  // What to draw and label: the real inner parts of this kind of thing, by their correct names,
  // from the built-in reference (skeleton and organs; or the inner parts of a machine), then any
  // other inner part the inside view named. Outside parts (an udder, a teat, a handle) are not drawn.
  const plan = planForObject(input.digest);
  const given = [...new Set((input.inside?.parts ?? []).map((p) => sanitizeText(p, 60)).filter(Boolean))];
  const inner = plan ? new Set([...plan.skeleton, ...plan.internal, ...plan.label].map((x) => normalizeForMatch(x))) : null;
  const outer = plan ? new Set(plan.external.map((x) => normalizeForMatch(x))) : null;
  const generic = /^(?:skeleton|torso|body|organs?|inside|interior|insides|whole body|body shell|casing|housing|outer casing)$/i;
  const own = (g: string) => !generic.test(g) && normalizeForMatch(g) !== normalizeForMatch(object);
  const planLabels = plan ? labelsFor(plan, `${object} ${input.digest.subcategory ?? ''} ${input.digest.summary}`) : [];
  const parts = (
    plan
      ? plan.living
        ? // A living thing: only true bones and organs, by their correct names.
          [...new Set([...planLabels, ...given.filter((g) => inner!.has(normalizeForMatch(g)) && !outer!.has(normalizeForMatch(g)))])]
        : // A machine: the inner parts researched for this one first (an electric car's inverter), then the reference's.
          [...new Set([...given.filter((g) => own(g) && !outer!.has(normalizeForMatch(g))), ...planLabels])]
      : given.filter(own)
  ).slice(0, 14);
  if (plan && input.inside) input = { ...input, inside: { ...input.inside, parts, brief: sanitizeText(`${plan.facts} ${input.inside.brief}`, 1200) } };
  else if (plan) input = { ...input, inside: { kind: plan.living ? 'living' : 'machine', brief: plan.facts, parts } };
  const spark = {
    client: meta.client,
    model: sparkModel(cfg, ctx.privacyTier),
    mode: 'json_schema' as const,
    instructionRole: 'developer' as const,
    reasoningEffort: 'low' as const,
    signal: ctx.signal,
    timeoutMs: cfg.requestTimeoutMs,
  };


  const size = input.photo ? { width: input.photo.width, height: input.photo.height } : null;

  // 0. Real references: public-domain pictures of the inside of this kind of thing (a cow's
  // skeleton, a cow's organs), so the drawing copies real anatomy instead of drawing from memory.
  // They guide the drawing only; they are not shown.
  const refs = input.photo ? await referencePictures(fetchImpl, referenceQueries(object, plan), 2, ctx.signal).catch(() => [] as ReferencePicture[]) : [];
  const kw = planKeyword(object, plan);
  const refNote = refs.length
    ? `The first image is the photo. The next ${refs.length === 1 ? 'image is a real reference picture' : `${refs.length} images are real reference pictures`} of the inside of a ${kw} (${refs.map((r) => r.title).join('; ')}). Copy the true shape, position, size and colour of every ${plan?.living ? 'bone and organ' : 'inner part'} from ${refs.length === 1 ? 'it' : 'them'}, while keeping the exact pose, position and framing of the photo.`
    : undefined;
  if (refs.length) {
    diagnostics.push(`Guided by ${refs.length} public-domain reference picture${refs.length === 1 ? '' : 's'}.`);
    log('info', 'cutaway reference pictures', { pictures: refs.map((r) => `${r.title} (${r.license}) ${r.page}`) });
  }

  // 1. Draw.
  const first = await meta.illustrate({ digest: input.digest, inside: input.inside, photo: input.photo, style: 'cutaway', references: refs.map((r) => r.image), instruction: refNote }, ctx);
  let clean = await toJpeg(first.value.base64, size);

  // 2. Check the drawing against the photo and against how this kind of object is inside.
  const review = async (img: ImagePayload): Promise<CutawayReview | null> => {
    try {
      const user = cutawayReviewUser(object, parts) + (refs.length && input.photo ? `\nThe third image is a real reference picture of the inside of a ${kw}: judge whether the bones and organs are the right shape, in the right place and the right size against it.` : '');
      const look = (await workingCopy(img, 1280)).img; // the check needs no more than this
      const r = await chatStructured({ ...spark, schema: CutawayReviewSchema, name: 'cutaway_review', system: CUTAWAY_REVIEW_SYSTEM, user, images: input.photo ? [input.photo, look, ...refs.slice(0, 1).map((x) => x.image)] : [look] });
      return r.value;
    } catch (e) {
      log('warn', 'cutaway review failed', { error: (e as Error).message });
      return null;
    }
  };
  const score = (r: CutawayReview | null) => (r ? r.matchesPhoto + r.accuracy * 1.5 : 0);
  let r1 = await review(clean);
  let redrawn = false;
  for (let round = 0; round < 2; round++) {
    if (!r1 || !((r1.matchesPhoto <= 3 || r1.accuracy <= 3 || r1.problems.length > 0) && (r1.fix || r1.problems.length))) break;
    // Fix every problem found, not only the main one: each is a concrete instruction.
    const fix = sanitizeText([r1.fix ?? '', ...r1.problems.filter((p) => !(r1!.fix ?? '').toLowerCase().includes(p.toLowerCase().slice(0, 30)))].filter(Boolean).join('; '), 700);
    try {
      const second = await meta.illustrate(
        {
          digest: input.digest,
          photo: input.photo ?? (await workingCopy(clean, 1536)).img,
          references: input.photo ? [(await workingCopy(clean, 1536)).img, ...refs.map((r) => r.image)] : [],
          style: 'cutaway',
          prompt: [
            input.photo ? 'The first image is the photo. The second image is a draft cutaway of it.' : 'This is a draft cutaway illustration.',
            refs.length && input.photo ? `The ${refs.length === 1 ? 'third image is a real reference picture' : 'remaining images are real reference pictures'} of the inside of a ${kw}: make the anatomy match ${refs.length === 1 ? 'it' : 'them'}.` : '',
            `Correct every one of these errors in the draft: ${fix}`,
            'Keep everything else in the draft exactly as it is: the pose, framing, background, colours, style and every other part. Only the inside is drawn (no skin, fur or outer casing). Every organ stays inside the bones that hold it, at its true size. Anatomy and construction must be true to this exact kind. No text or labels.',
          ]
            .filter(Boolean)
            .join(' '),
        },
        ctx,
      );
      const redraw = await toJpeg(second.value.base64, size);
      const r2 = await review(redraw);
      if (!r2 || score(r2) >= score(r1)) {
        clean = redraw;
        r1 = r2 ?? r1;
        redrawn = true;
        diagnostics.push(`Corrected: ${fix}`);
      } else break;
    } catch (e) {
      log('warn', 'cutaway correction failed; keeping the drawing so far', { error: (e as Error).message });
      break;
    }
  }
  const reviewOut = r1 ? { matchesPhoto: clamp5(r1.matchesPhoto), accuracy: clamp5(r1.accuracy), problems: r1.problems.slice(0, 5).map((p) => sanitizeText(p, 200)), redrawn } : null;

  // 3. Find each part that is drawn, outline it and check it; the app shows the labels.
  // The check lists the parts it can see clearly. Its names may differ a little from ours ("steel
  // shaft" for "shaft"), so they are matched loosely; and when it names fewer than two of them,
  // every part is still looked for (an outline is only kept where a part is actually found).
  const shownList = (r1?.shown ?? []).map((s) => normalizeForMatch(s)).filter(Boolean);
  const isShown = (p: string) => {
    const n = normalizeForMatch(p);
    return shownList.some((s) => s === n || s.includes(n) || n.includes(s));
  };
  const shownParts = parts.filter(isShown);
  const toFind = (shownParts.length >= Math.min(2, parts.length) ? shownParts : parts).slice(0, 14);
  let regions: Region[] = [];
  let labels: CutawayResult['labels'] = null;
  if (toFind.length) {
    try {
      // Outline every candidate part first, then have each numbered outline named (Set-of-Mark):
      // more reliable than asking a model to point at "the heart" in a busy drawing.
      // On a working copy (the full drawing is large; finding parts needs only about 1300 px),
      // then mapped back onto the full drawing.
      const work = await workingCopy(clean, 1280);
      const found = await nameByMarks(meta.labelDeps(ctx), work.img, toFind, {
        object: `the inside of a ${object}`,
        vocabulary: plan ? [...plan.skeleton, ...plan.internal] : [],
      });
      found.regions = scaleRegions(found.regions, work.kx, work.ky);
      diagnostics.push(...found.diagnostics);
      const norm = new Map(toFind.map((p) => [normalizeForMatch(p), p]));
      // Labels use the exact part names (a found outline named slightly differently is matched back);
      // an outline that is not one of the inner parts asked for (the animal's name, "torso") is dropped.
      const vocab = new Map((plan ? [...plan.skeleton, ...plan.internal] : []).map((v) => [normalizeForMatch(v), v]));
      regions = found.regions
        .map((r) => {
          const n = normalizeForMatch(r.label);
          const name = norm.get(n) ?? [...norm.entries()].find(([k]) => n.includes(k) || k.includes(n))?.[1] ?? vocab.get(n) ?? null;
          return name ? { ...r, label: name } : null;
        })
        .filter((r): r is Region => !!r && normalizeForMatch(r.label) !== normalizeForMatch(object) && !generic.test(r.label))
        .filter((r, i, a) => a.findIndex((x) => normalizeForMatch(x.label) === normalizeForMatch(r.label)) === i);
      const located = regions.map((r) => r.label).filter((l) => norm.has(normalizeForMatch(l)));
      labels = { expected: toFind, correct: located, problems: toFind.filter((p) => !located.includes(p)).map((p) => `${p} is not clearly drawn`), fixed: false };
    } catch (e) {
      log('warn', 'finding the parts in the cutaway failed; showing it without labels', { error: (e as Error).message });
      diagnostics.push('The parts could not be found in the drawing this time.');
    }
  }

  return {
    image: plain(clean),
    clean: plain(clean),
    regions,
    review: reviewOut,
    labels,
    diagnostics: diagnostics.slice(0, 10),
  };
}
