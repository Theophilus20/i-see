/**
 * A stand-in for the Meta Model API (and two OpenAI-compatible open-weight hosts) that
 * mirrors the documented request and response shapes:
 *
 *   POST /v1/chat/completions   Muse Spark: json_schema structured output
 *   POST /v1/responses          SAM 3.1 (SSE stream, real wire sample from @meta-sam/parser),
 *                               Muse Wonder (text.format), Muse Image (image_generation_call),
 *                               web_search grounding (url_citation annotations)
 *   POST /v1/asr/transcribe     Muse Voice Transcribe (multipart: request JSON + audio WAV)
 *   POST /ow/v1/chat/completions     open-weight host, JSON in the prompt (no json_schema)
 *   POST /local/v1/chat/completions  local Muse Glimmer, unsure answers (for escalation tests)
 *
 * It is a test double. Passing these tests shows the gateway speaks the documented
 * protocol; it does not show the live service behaves identically.
 */
import { encodeSegmentationMask } from '../../node_modules/@meta-sam/parser/dist/mask-codec.js';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TEST_KEY = 'LLM|123|test-secret-key';

/** A filled rectangle as a SAM mask token, w × h pixels. */
const rectTokens = new Map<string, string>();
function rectMask(w: number, h: number): string {
  const key = `${w}x${h}`;
  if (!rectTokens.has(key)) rectTokens.set(key, `<|mask;x=0;y=0;data=${h},${w},${encodeSegmentationMask(new Uint8Array(w * h).fill(1), w, h).payload}|>`);
  return rectTokens.get(key)!;
}
/**
 * The stand-in photo's "scene" on the 0-1000 grid: the whole object, nine parts in a grid inside
 * it, and two small parts inside the first two (like a nose inside a muzzle). A point prompt
 * gets the smallest of these that holds the point.
 */
const SCENE = {
  whole: { x: 100, y: 100, s: 800 },
  parts: Array.from({ length: 9 }, (_, i) => ({ x: 150 + (i % 3) * 250, y: 150 + Math.floor(i / 3) * 250, s: 200 })),
  nested: [{ x: 220, y: 220, s: 100 }, { x: 470, y: 220, s: 100 }],
};

/** The SAM 3.1 wire sample from the @meta-sam/parser README: frame 0 of a 320×334 image, two objects. */
/** One mask payload (27 rows × 60 columns), reused for every requested object. */
const MASK_27x60 = "~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(";
export const SAM_WIRE =
  '<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334;c=0.91|>' +
  "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>" +
  ',1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334;c=0.84|>' +
  '<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>\n';

export const GROUNDED = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/grounded.json', import.meta.url)), 'utf8'));

// 1×1 PNG
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// An 800×600 drawing for the cutaway (made once, at start).
let PNG_800x600 = PNG_1PX;

export interface Recorded {
  path: string;
  auth: string | null;
  contentType: string | null;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  raw: Buffer;
}

function sourceIdFor(text: string, title: string): string {
  const m = new RegExp(`<source id="([^"]+)" title="${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).exec(text);
  return m?.[1] ?? 's1';
}

export function identifyOutput(unsure = false) {
  return {
    quality: { adequate: true, issues: [], advice: [] },
    objectCount: 1,
    primary: {
      description: 'An eight-sided metal pot with a hinged lid, a black handle and a small valve on the lower body.',
      category: 'consumer_product',
      subcategory: 'coffee maker',
      hazards: ['pressure', 'thermal'],
    },
    candidates: unsure
      ? [
          { name: 'Stovetop coffee maker', category: 'consumer_product', likelihood: 0.4, evidenceFor: ['two-part body'], evidenceAgainst: [], missing: ['maker mark'] },
          { name: 'Kettle', category: 'consumer_product', likelihood: 0.35, evidenceFor: ['handle'], evidenceAgainst: ['no spout'], missing: [] },
        ]
      : [
          { name: 'Moka pot', category: 'consumer_product', likelihood: 0.5, evidenceFor: ['octagonal body', 'safety valve'], evidenceAgainst: [], missing: ['maker stamp under the base'] },
          { name: 'Stovetop percolator', category: 'consumer_product', likelihood: 0.38, evidenceFor: ['stovetop design'], evidenceAgainst: ['no glass knob'], missing: ['view inside the lid'] },
        ],
    concepts: [
      { phrase: 'coffee pot', role: 'whole', reason: 'the subject' },
      { phrase: 'safety valve', role: 'part', reason: 'pressure relief' },
      { phrase: 'Segment the handle!', role: 'part', reason: 'a malformed phrase the gateway must clean' },
    ],
    pointers: [{ phrase: 'coffee pot', x: 0.5, y: 0.6 }],
    textRead: [{ text: 'MADE IN ITALY', location: 'base' }],
    retrievalQueries: [
      { query: 'moka pot', intent: 'identify' },
      { query: 'moka pot history', intent: 'history' },
      { query: 'stovetop espresso maker recall', intent: 'safety' },
    ],
  };
}

function coreOutput(user: string) {
  const wiki = sourceIdFor(user, 'Moka pot');
  return {
    displayName: 'Moka pot',
    subcategory: 'stovetop coffee maker',
    summary: 'A stovetop coffee maker that pushes hot water through ground coffee using steam pressure.',
    identityStatus: 'identified',
    topCandidate: 'Moka pot',
    findings: [
      { ref: 'f1', section: 'identity', text: 'An eight-sided metal pot with a hinged lid.', basis: 'observed', confidence: 0.95, regionIds: ['r1'], sourceIds: [], quote: null },
      { ref: 'f2', section: 'origin', text: 'The design was invented by Luigi De Ponti for Alfonso Bialetti in 1933.', basis: 'sourced', confidence: 0.9, regionIds: [], sourceIds: [wiki], quote: 'invented by the Italian engineer Luigi De Ponti for Alfonso Bialetti in 1933' },
      { ref: 'f3', section: 'operation', text: 'Steam pressure in the lower chamber pushes water up through the coffee.', basis: 'inferred', confidence: 0.8, regionIds: [], sourceIds: [], quote: null },
      { ref: 'f4', section: 'materials', text: 'The body is probably cast aluminium.', basis: 'hypothesis', confidence: 0.9, regionIds: ['r1'], sourceIds: [], quote: null },
      { ref: 'f5', section: 'origin', text: 'It was made in Milan in 1950.', basis: 'sourced', confidence: 0.9, regionIds: [], sourceIds: ['s99'], quote: 'made in Milan in 1950' },
      { ref: 'f6', section: 'uses', text: 'It makes strong coffee.', basis: 'sourced', confidence: 0.85, regionIds: [], sourceIds: [wiki], quote: 'makes the best coffee in the world' },
    ],
    components: [
      { name: 'Boiler', role: 'Holds the water.', regionId: 'r1', material: 'aluminium', parent: null, visibleInPhoto: true, basis: 'observed' },
      { name: 'Funnel filter', role: 'Holds the ground coffee.', regionId: null, material: null, parent: 'Boiler', visibleInPhoto: false, basis: 'inferred' },
      { name: 'Safety valve', role: 'Releases pressure if the funnel clogs.', regionId: 'r2', material: 'brass', parent: 'Boiler', visibleInPhoto: true, basis: 'observed' },
    ],
    conflicts: [],
    openQuestions: ['Photograph the underside to look for a maker stamp.'],
  };
}

function extrasOutput(user: string) {
  const wiki = sourceIdFor(user, 'Moka pot');
  return {
    timeline: [
      { label: 'Invented', detail: null, from: 1933, to: null, approx: false, basis: 'sourced', confidence: 0.9, regionIds: [], sourceIds: [wiki], quote: 'Luigi De Ponti for Alfonso Bialetti in 1933' },
    ],
    safety: [
      { hazard: 'pressure', severity: 'warning', text: 'Never open the pot while it is hot and under pressure.', advice: 'Let it cool first.', professionalReview: false, basis: 'inferred', confidence: 0.8, regionIds: ['r2'], sourceIds: [], quote: null },
    ],
    related: [{ name: 'Espresso machine', relation: 'Uses higher pressure', basis: 'inferred', confidence: 0.7, regionIds: [], sourceIds: [], quote: null }],
    live: [],
    whatIf: [
      {
        title: 'How long to heat the water?',
        question: 'How long until it brews on a 1.5 kW ring?',
        kind: 'simulation',
        summary: 'Energy needed divided by the power that reaches the water.',
        assumptions: [
          { key: 'm', label: 'Water', value: 0.3, unit: 'kg', min: 0.1, max: 0.5, step: 0.05, origin: 'assumed', note: null },
          { key: 'c', label: 'Specific heat', value: 4186, unit: 'J/(kg*K)', min: 4100, max: 4200, step: 1, origin: 'sourced', note: null },
          { key: 'dT', label: 'Temperature rise', value: 75, unit: 'K', min: 40, max: 80, step: 1, origin: 'assumed', note: null },
          { key: 'P', label: 'Burner power', value: 1500, unit: 'W', min: 500, max: 3000, step: 50, origin: 'assumed', note: null },
          { key: 'eta', label: 'Efficiency', value: 0.4, unit: '', min: 0.1, max: 0.9, step: 0.05, origin: 'assumed', note: null },
        ],
        steps: [
          { key: 'Q', label: 'Heat', expr: 'm * c * dT', unit: 'J' },
          { key: 't', label: 'Time', expr: 'Q / (P * eta) / 60', unit: 'min' },
        ],
        resultKey: 't',
        sweepKey: 'P',
        caveats: [],
        safety: null,
        sourceIds: [],
      },
    ],
  };
}

const RESOLVE = {
  ranking: [
    { candidateName: 'Moka pot', likelihood: 0.82, evidenceFor: ['safety valve on the boiler'], evidenceAgainst: [] },
    { candidateName: 'Stovetop percolator', likelihood: 0.12, evidenceFor: [], evidenceAgainst: ['no glass knob'] },
    { candidateName: 'Invented thing', likelihood: 0.5, evidenceFor: [], evidenceAgainst: [] },
  ],
  nextShot: { instruction: 'Unscrew the top and photograph the funnel.', why: 'A funnel filter is unique to the moka pot.', separates: ['Moka pot', 'Stovetop percolator'], capture: 'detail', target: 'funnel', expectedGain: 0.6 },
  alternativeExplanations: ['A decorative replica'],
  researchQuestions: ['Which maker used this valve shape?'],
};

const ASK = {
  segments: [
    { text: 'The valve releases steam if pressure builds up.', basis: 'sourced', confidence: 0.9, regionIds: ['r2', 'r404'], sourceIds: ['zzz'], quote: 'made up' },
    { text: 'It is likely brass.', basis: 'hypothesis', confidence: 0.95, regionIds: [], sourceIds: [], quote: null },
  ],
  followUps: ['How do I descale it?'],
  needsEvidence: null,
  refused: null,
};

const COMPARE = {
  headline: 'One uses steam pressure, the other gravity.',
  differences: [{ aspect: 'Brewing', a: 'Steam pressure', b: 'Gravity', matters: 'Taste and strength', basis: 'sourced', confidence: 0.9, regionIds: [], sourceIds: ['nope'], quote: 'x' }],
  similarities: ['Both sit on a stove.'],
  advice: null,
};

const INSIDE = {
  kind: 'machine',
  intro: 'Two chambers joined by a funnel. Pressure pushes water through the coffee.',
  groups: [
    {
      name: 'Lower chamber',
      role: 'Builds pressure.',
      parts: [
        { name: 'Boiler', what: 'Holds water.', how: 'Traps vapour so pressure rises.', regionId: 'r1', visibleInPhoto: true, basis: 'observed', confidence: 0.9, regionIds: ['r1'], sourceIds: [], quote: null },
        { name: 'Gasket', what: 'Seals the halves.', how: 'It is squeezed when assembled.', regionId: 'r99', visibleInPhoto: true, basis: 'sourced', confidence: 0.9, regionIds: [], sourceIds: ['ghost'], quote: 'not in any source at all here' },
      ],
    },
  ],
  flows: [{ title: 'Water to coffee', summary: 'Heat, pressure, extraction.', steps: [{ label: 'Heat', detail: 'Water warms.' }, { label: 'Rise', detail: 'Water climbs the funnel.' }], basis: 'inferred', confidence: 0.8, regionIds: [], sourceIds: [], quote: null }],
  illustrationBrief: 'A cutaway of a moka pot.',
};
const GLANCE = { label: 'Moka pot', confidence: 0.82, hint: null };
/** What the deep check between close candidates answers ("cannot tell" leaves the doubt to Muse Wonder). */
let decideAnswer = 'Moka pot';
export function setDecideAnswer(a: string): void {
  decideAnswer = a;
}

/** What the blind label check says each numbered outline covers (none: no verdicts, all kept). */
let checkAnswer: ((count: number) => Array<{ n: number; covers: string | null; fits: boolean }>) | null = null;
export function setCheckAnswer(f: typeof checkAnswer): void {
  checkAnswer = f;
}
/** How the region-naming step names the numbered regions (default: in order, with the parts noticed). */
let marksAnswer: ((count: number, noticed: string[]) => Array<{ n: number; name: string | null }>) | null = null;
export function setMarksAnswer(f: typeof marksAnswer): void {
  marksAnswer = f;
}
/** The second look's answer, given the two names as shown (A and B). Default: A. */
/**
 * How one region seen up close is named. By default the stand-in cannot tell which region it is
 * shown, so its answer is unusable and the first look is kept (the path when a close look fails).
 */
let closeAnswer: ((user: string) => { looks: string; name: string | null; fits: 'well' | 'partly' | 'badly'; sure: boolean }) | null = null;
export function setCloseAnswer(f: typeof closeAnswer): void {
  closeAnswer = f;
}
let secondOpinionAnswer: ((a: string, b: string) => { choice: 'A' | 'B' | 'neither'; sure: boolean; reason: string }) | null = null;
export function setSecondOpinion(f: typeof secondOpinionAnswer): void {
  secondOpinionAnswer = f;
}
/** Parts the stand-in "sees" in the photo beyond those it is asked about. */
const SEEN_EXTRA = ['Lid', 'Filter funnel'];

function pickOutput(name: string | null, system: string, user: string, unsure: boolean): unknown {
  const n = name ?? (system.includes('examining eye') ? 'identify' : system.includes('You write the findings') ? 'profile_core' : system.includes('You write the timeline') ? 'profile_extras' : system.includes('settle a doubt') ? 'resolve' : system.includes('answer a question') ? 'ask' : system.includes('explain the inside') ? 'inside' : system.includes('live phone camera') ? 'glance' : system.includes('translate the interface') ? 'translate' : 'compare');
  switch (n) {
    case 'identify':
      return identifyOutput(unsure);
    case 'profile_core':
      return coreOutput(user);
    case 'profile_extras':
      return extrasOutput(user);
    case 'resolve':
      return RESOLVE;
    case 'ask':
      return ASK;
    case 'inside':
      return INSIDE;
    case 'glance':
      return GLANCE;
    case 'ground': {
      const names = [...user.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]!);
      // A close-up look confirms nothing new here (the first look is kept).
      if (/close-up/.test(user)) return { parts: names.map((name) => ({ name, visible: false, boxes: [] })), extra: [] };
      // The whole object gets a big box; the parts get boxes side by side, like real parts. The
      // parts seen by looking sit partly inside a listed part's box (like the nose inside the
      // muzzle), so the "not this" points are exercised.
      const at = (r: { x: number; y: number; s: number }) => ({ x_min: r.x, y_min: r.y, x_max: r.x + r.s, y_max: r.y + r.s });
      return {
        parts: names.map((name, i) => ({ name, visible: true, boxes: [i === 0 ? at(SCENE.whole) : at(SCENE.parts[(i - 1) % 9]!)] })),
        extra: SEEN_EXTRA.filter((x) => !names.some((n) => n.toLowerCase() === x.toLowerCase())).map((name, k) => ({ name, boxes: [at(SCENE.nested[k % 2]!)] })),
      };
    }
    case 'close_name':
      return closeAnswer ? closeAnswer(user) : { unusable: true };
    case 'second_opinion': {
      const m = /A\) "([^"]+)" or B\) "([^"]+)"/.exec(user);
      return secondOpinionAnswer ? secondOpinionAnswer(m?.[1] ?? '', m?.[2] ?? '') : { choice: 'A', sure: true, reason: 'The shape and position match.' };
    }
    case 'part_marks': {
      // Names the numbered regions in order with the parts noticed (the real model looks at them).
      const count = Number(/with (\d+) numbered regions/.exec(user)?.[1] ?? 0);
      const noticed = (/Parts already noticed in this photo \(use these names when they fit\): (.+)\./.exec(user)?.[1] ?? '').split(', ').filter(Boolean);
      const answer = marksAnswer ? marksAnswer(count, noticed) : Array.from({ length: count }, (_, i) => ({ n: i + 1, name: noticed[i] ?? null }));
      return { regions: answer, missing: [] };
    }
    case 'label_check': {
      const count = Number(/The image has (\d+) numbered/.exec(user)?.[1] ?? 0);
      return { regions: checkAnswer ? checkAnswer(count) : [], missing: [] };
    }
    case 'screen_sources':
      return { sources: [...user.matchAll(/^\[(s\d+)\] (.*?):/gm)].map((m) => ({ id: m[1], relevant: !/carnival|^art$/i.test(m[2]!) })) };
    case 'cutaway_review': {
      const shown = (/Parts it should show: (.+)\./.exec(user)?.[1] ?? '').split(', ').filter(Boolean);
      return { matchesPhoto: 4, accuracy: 4, shown, problems: [], fix: null };
    }
    case 'mark_names': {
      // Names each numbered outline in order (the real model judges from the picture).
      const names = [...(/Names to choose from: (.+)\./.exec(user)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
      return { marks: names.map((name, i) => ({ n: i + 1, name, sure: true })) };
    }
    case 'decide':
      return {
        features: [
          { feature: 'Octagonal two-part body that screws together at the waist', inPhoto: 'An eight-sided body with a joint at the waist', pointsTo: 'Moka pot' },
          { feature: 'Glass viewing knob on the lid', inPhoto: 'not visible', pointsTo: null },
        ],
        answer: decideAnswer,
        confidence: decideAnswer === 'cannot tell' ? 0.3 : 0.86,
        reason: 'The eight-sided body screwed together at the waist and the safety valve are what a moka pot has; a percolator does not.',
      };
    case 'translate': {
      const strings = (JSON.parse(user) as { strings: string[] }).strings;
      return { translations: strings.map((t) => `«${t}»`) };
    }
    default:
      return COMPARE;
  }
}

const chatUsage = { prompt_tokens: 1200, completion_tokens: 300, completion_tokens_details: { reasoning_tokens: 120 }, prompt_tokens_details: { cached_tokens: 0 } };

export class MockMeta {
  readonly requests: Recorded[] = [];
  private failures: Array<{ prefix: string; status: number; headers?: Record<string, string>; body?: unknown }> = [];
  private server: Server | null = null;
  url = '';
  /** Return invalid JSON once for this schema name, to exercise the repair path. */
  breakSchemaOnce: string | null = null;
  /** Leave the last object out of this many multi-object SAM answers (a cut-short answer). */
  samDropLast = 0;
  /** Refuse the extra image-quality settings, as an API that does not know them would. */
  rejectImageQuality = false;

  failNext(prefix: string, status: number, times = 1, headers?: Record<string, string>, body?: unknown): void {
    for (let i = 0; i < times; i++) this.failures.push({ prefix, status, headers, body });
  }

  count(prefix: string): number {
    return this.requests.filter((r) => r.path.startsWith(prefix)).length;
  }

  async start(): Promise<string> {
    const sharp = (await import('sharp')).default;
    // A drawing on white paper: grey and coloured blocks with a margin of paper.
    const blocks = ['#8d959c', '#c2541e', '#2d6cdf', '#f2c230', '#555b61', '#0b8a78']
      .map((c, i) => `<rect x="${30 + (i % 3) * 250}" y="${30 + Math.floor(i / 3) * 280}" width="230" height="260" rx="18" fill="${c}"/>`)
      .join('');
    const art = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#ffffff"/>${blocks}</svg>`);
    PNG_800x600 = (await sharp(art).png().toBuffer()).toString('base64');
    this.server = createServer((req, res) => {
      void this.handle(req).then(
        ({ status, headers, body }) => {
          res.writeHead(status, headers);
          res.end(body);
        },
        (e: unknown) => {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: String(e), type: 'server_error', code: 'internal' } }));
        },
      );
    });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    const addr = this.server.address();
    this.url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    return this.url;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  private async handle(req: IncomingMessage): Promise<{ status: number; headers: Record<string, string>; body: string | Buffer }> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const path = req.url ?? '/';
    const ct = req.headers['content-type'] ?? null;
    let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (ct?.includes('application/json')) body = JSON.parse(raw.toString('utf8') || 'null');
    this.requests.push({ path, auth: (req.headers.authorization as string) ?? null, contentType: ct, body, raw });
    const json = (status: number, data: unknown, headers: Record<string, string> = {}) => ({ status, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) });

    const f = this.failures.findIndex((x) => path.startsWith(x.prefix));
    if (f >= 0) {
      const fail = this.failures.splice(f, 1)[0]!;
      return json(fail.status, fail.body ?? { error: { message: `forced ${fail.status}`, type: 'test', code: `forced_${fail.status}`, param: null } }, fail.headers);
    }

    const isMeta = path.startsWith('/v1/');
    if (isMeta && req.headers.authorization !== `Bearer ${TEST_KEY}`) return json(401, { error: { message: 'Invalid API key', type: 'invalid_request_error', code: 'invalid_api_key', param: null } });

    if (path === '/v1/models' && req.method === 'GET') {
      const ids = ['muse-spark-1.3', 'muse-spark-1.3-contributor', 'muse-wonder-1.0', 'muse-image-1.0', 'muse-voice-transcribe-1.0', 'sam-3.1'];
      return json(200, { object: 'list', data: ids.map((id) => ({ id, object: 'model', created: 0, owned_by: 'meta' })) });
    }

    if (path.endsWith('/chat/completions')) {
      const messages = body.messages as Array<{ role: string; content: unknown }>;
      const system = String(messages[0]?.content ?? '');
      const userMsg = messages[1]?.content;
      const user = typeof userMsg === 'string' ? userMsg : (userMsg as Array<{ type: string; text?: string }>).filter((p) => p.type === 'text').map((p) => p.text).join('');
      const name = body.response_format?.json_schema?.name ?? null;
      const out = pickOutput(name, system, user, path.startsWith('/local/'));
      let content = JSON.stringify(out);
      if (name && this.breakSchemaOnce === name && messages.length === 2) {
        this.breakSchemaOnce = null;
        content = JSON.stringify({ ...(out as object), candidates: 'not a list' });
      }
      if (!name) content = `Here is the JSON:\n\`\`\`json\n${content}\n\`\`\``;
      return json(200, { id: 'chatcmpl-1', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: chatUsage });
    }

    if (path === '/v1/responses') {
      if (body.model === 'sam-3.1') {
        const text = String(body.input?.[0]?.content?.[0]?.text ?? '');
        // Object prompts ("<0f>3<|box;…|>…"): answer each requested object under its own id, with an
        // outline at its box. Text prompts get the two fixed instances.
        let asked = [...text.matchAll(/(?:^|<0f>|,)(\d+)<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)\|>/g)];
        // Point prompts: the region of the scene under each point, traced as a rectangle.
        const pts = [...text.matchAll(/(?:^|<0f>|,)(\d+)<\|point;x=(\d+);y=(\d+);w=(\d+);h=(\d+)\|>/g)];
        if (pts.length && !asked.length) {
          const tokens = pts.map(([, id, px, py, pw, ph]) => {
            const W = Number(pw);
            const H = Number(ph);
            const gx = (Number(px) / W) * 1000;
            const gy = (Number(py) / H) * 1000;
            const hit = [...SCENE.nested, ...SCENE.parts, SCENE.whole].find((r) => gx >= r.x && gx < r.x + r.s && gy >= r.y && gy < r.y + r.s);
            const r = hit ?? { x: Math.max(0, gx - 20), y: Math.max(0, gy - 20), s: 40 };
            const x1 = Math.round((r.x / 1000) * W);
            const y1 = Math.round((r.y / 1000) * H);
            const w = Math.max(2, Math.min(W - x1, Math.round((r.s / 1000) * W)));
            const h = Math.max(2, Math.min(H - y1, Math.round((r.s / 1000) * H)));
            return `${id}<|box;x1=${x1};y1=${y1};x2=${x1 + w - 1};y2=${y1 + h - 1};w=${W};h=${H};c=0.9|>${rectMask(w, h)}`;
          });
          const body = '<0f>' + tokens.join(',') + '\n';
          const lane = { item_id: 'msg_1', output_index: 0, content_index: 0 };
          const events = [
            { type: 'response.created', response: { id: 'resp_sam', status: 'in_progress' } },
            { type: 'response.output_item.added', output_index: 0, item: { id: 'msg_1', type: 'message' } },
            { type: 'response.output_text.delta', ...lane, delta: body },
            { type: 'response.content_part.done', ...lane, part: { type: 'output_text', text: body } },
            { type: 'response.completed', response: { id: 'resp_sam', status: 'completed' } },
          ];
          return { status: 200, headers: { 'content-type': 'text/event-stream' }, body: events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('') };
        }
        if (this.samDropLast > 0 && asked.length > 1) {
          this.samDropLast--;
          asked = asked.slice(0, -1);
        }
        const lines =
          text === 'nothing here'
            ? ''
            : asked.length
              ? '<0f>' +
                asked
                  .map(([, id, x1, y1, x2, y2, w, h]) => {
                    // A box covering most of the photo is the whole object: its outline fills the box.
                    const bw = Number(x2) - Number(x1);
                    const bh = Number(y2) - Number(y1);
                    if (bw * bh > Number(w) * Number(h) * 0.4) return `${id}<|box;x1=${x1};y1=${y1};x2=${Number(x1) + bw - 1};y2=${Number(y1) + bh - 1};w=${w};h=${h};c=0.95|>${rectMask(bw, bh)}`;
                    const left = Math.min(Number(x1), Number(w) - 60);
                    const top = Math.min(Number(y1), Number(h) - 27);
                    return `${id}<|box;x1=${left};y1=${top};x2=${left + 59};y2=${top + 26};w=${w};h=${h};c=0.9|><|mask;x=0;y=0;data=27,60,${MASK_27x60}|>`;
                  })
                  .join(',') +
                '\n'
              : SAM_WIRE;
        const lane = { item_id: 'msg_1', output_index: 0, content_index: 0 };
        const split = Math.max(1, lines.indexOf(',1<|box'));
        const events = [
          { type: 'response.created', response: { id: 'resp_sam', status: 'in_progress' } },
          { type: 'response.output_item.added', output_index: 0, item: { id: 'msg_1', type: 'message' } },
          ...(lines ? [{ type: 'response.output_text.delta', ...lane, delta: lines.slice(0, split) }, { type: 'response.output_text.delta', ...lane, delta: lines.slice(split) }] : []),
          { type: 'response.content_part.done', ...lane, part: { type: 'output_text', text: lines } },
          { type: 'response.completed', response: { id: 'resp_sam', status: 'completed' } },
        ];
        return { status: 200, headers: { 'content-type': 'text/event-stream' }, body: events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('') };
      }
      if (body.model === 'muse-wonder-1.0') {
        if (body.input.some((m: { content: Array<{ type: string }> }) => m.content.some((c) => c.type === 'input_image'))) return json(400, { error: { message: 'images not expected', type: 'invalid_request_error', code: 'bad', param: 'input' } });
        return json(200, { id: 'resp_w', output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(RESOLVE), annotations: [] }] }], usage: { input_tokens: 900, output_tokens: 400, output_tokens_details: { reasoning_tokens: 300 } } });
      }
      if (body.model === 'muse-image-1.0') {
        if (this.rejectImageQuality && body.tools?.[0]?.quality) return json(400, { error: { message: 'Unknown parameter: quality', type: 'invalid_request_error', code: 'unknown_parameter', param: 'tools[0].quality' } });
        return json(200, { id: 'resp_i', output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Here is your image.' }] }, { type: 'image_generation_call', id: 'ig_1', status: 'completed', result: Array.isArray(body.input) ? PNG_800x600 : PNG_1PX }], usage: { input_tokens: 50, output_tokens: 10 } });
      }
      if (Array.isArray(body.tools) && body.tools.some((t: { type: string }) => t.type === 'web_search')) {
        // The part-names research answers as a list, one part per line.
        if (String(body.input).includes('one part per line')) {
          const text = '- Lid: the hinged top cover.\n- Filter funnel: holds the ground coffee.\n- Safety valve: lets steam out if the pressure gets too high.\n- Handle: heat-resistant grip on the upper chamber.';
          return json(200, {
            id: 'resp_parts',
            output: [
              { type: 'web_search_call', id: 'ws_p', status: 'completed' },
              { type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [{ type: 'url_citation', url: 'https://www.bialetti.com/moka-parts', title: 'Moka pot parts | Bialetti', start_index: 0, end_index: text.length }] }] },
            ],
            usage: { input_tokens: 40, output_tokens: 30 },
          });
        }
        return json(200, GROUNDED);
      }
      return json(400, { error: { message: `unknown model ${body.model}`, type: 'invalid_request_error', code: 'model_not_found', param: 'model' } });
    }

    if (path === '/v1/asr/transcribe') {
      const text = raw.toString('latin1');
      if (!ct?.startsWith('multipart/form-data') || !text.includes('"model":"muse-voice-transcribe-1.0"') || !text.includes('RIFF')) {
        return json(400, { error: { message: 'malformed', type: 'invalid_request_error', code: 'bad', param: null } });
      }
      return json(200, { sessionId: 'sess-1', transcript: 'what is the little valve for', audioDurationMs: 1000, turns: [] });
    }
    return json(404, { error: { message: 'not found', type: 'invalid_request_error', code: 'not_found', param: null } });
  }
}
