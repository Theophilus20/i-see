import type { SampleSpec } from './types';
import { RETRIEVED_AT } from './types';

const BRENNAN = [
  'BSP threads are rounded in the peaks and valleys and have a 55-degree thread angle',
  'NPT threads are pointed in the peaks and valleys with a 60-degree thread angle',
  'they are not interchangeable',
  'There have been attempts to thread an NPT male form into a BSPP female form because they sometimes appear similar at first glance.',
  'the dissimilar pitch will cause a misalignment of the threads leading to leakage and failure under pressure.',
  'They are often denoted as straight threads because of their constant diameter and parallel thread form',
  'Their tapered thread diameter varies along the length',
  'NPT and NPTF thread forms are nearly identical',
].join(' … ');

const GEWINDE = [
  'American Taper Pipe Thread, with sealant compound.',
  'National Pipe Taper (1:16)',
  'The flank angle is 60°, the profile was originated by William Sellers.',
].join(' … ');

const NPT = 'Brass adapter, 1/2-inch NPT male thread to solder cup';
const BSP = 'Brass adapter, 1/2-inch BSP male thread to solder cup';
const COMPRESSION = 'Brass compression fitting body, nut missing';

export const fitting: SampleSpec = {
  id: 'fitting',
  title: 'Brass pipe fitting',
  blurb: 'A genuinely ambiguous part: competing identities, the one photo that would settle it, and safety claims held to a higher standard.',
  shows: ['Competing candidates weighed by Muse Wonder', 'The next photo that would settle it', 'A safety claim downgraded for lack of an authoritative source', 'An unsafe assurance replaced'],
  parts: ['hex', 'thread', 'cup', 'marking'],
  identify: {
    quality: { adequate: true, issues: [], advice: ['A close, side-on photo of the thread would show its profile.'] },
    objectCount: 1,
    primary: {
      description:
        'A short yellow-metal part with a six-sided middle section, an external screw thread at one end and a plain smooth sleeve at the other. "1/2" is stamped on one flat of the hex.',
      category: 'component',
      subcategory: 'Pipe fitting',
      hazards: ['pressure'],
    },
    candidates: [
      {
        name: NPT,
        category: 'component',
        likelihood: 0.42,
        evidenceFor: ['External thread that looks slightly tapered', 'Smooth sleeve sized for a pipe end', '"1/2" stamped as a nominal size'],
        evidenceAgainst: ['The thread profile cannot be seen closely enough to confirm 60° crests'],
        missing: ['A close side-on view of the thread crests', 'Any "NPT" marking'],
      },
      {
        name: BSP,
        category: 'component',
        likelihood: 0.36,
        evidenceFor: ['Same overall form is sold for British pipe threads', '"1/2" is also a BSP size'],
        evidenceAgainst: ['No "G", "R" or "BSP" marking visible'],
        missing: ['A close side-on view of the thread crests'],
      },
      {
        name: COMPRESSION,
        category: 'component',
        likelihood: 0.14,
        evidenceFor: ['Hex body with a plain end'],
        evidenceAgainst: ['A compression body needs an external thread at the plain end for its nut'],
        missing: ['A look at the plain end for threads or an olive seat'],
      },
    ],
    concepts: [
      { phrase: 'hex body', role: 'part', reason: 'Six-sided middle for a spanner.' },
      { phrase: 'external thread', role: 'part', reason: 'Screw thread at one end.' },
      { phrase: 'solder cup', role: 'part', reason: 'Plain sleeve at the other end.' },
      { phrase: 'stamped marking', role: 'marking', reason: '"1/2" on one flat.' },
    ],
    pointers: [
      { phrase: 'hex body', x: 0.45, y: 0.5 },
      { phrase: 'external thread', x: 0.68, y: 0.5 },
      { phrase: 'solder cup', x: 0.28, y: 0.42 },
      { phrase: 'stamped marking', x: 0.49, y: 0.27 },
    ],
    textRead: [{ text: '1/2', location: 'stamped on a flat of the hex' }],
    retrievalQueries: [
      { query: 'BSP vs NPT thread difference', intent: 'identify' },
      { query: 'NPT pipe thread', intent: 'specs' },
    ],
  },
  sources: [
    {
      id: 's1',
      connector: 'web',
      kind: 'sample',
      url: 'https://blog.brennaninc.com/bsp-npt-difference',
      title: 'BSP and NPT threads (blog post)',
      publisher: 'Brennan Industries',
      tier: 4,
      category: 'specialist',
      publishedAt: '2021-08-11',
      retrievedAt: RETRIEVED_AT,
      snippet: BRENNAN,
      contentHash: 'sample-fitting-1',
      license: null,
      note: 'A fittings supplier’s blog: a specialist source, not a standards body. Excerpts copied word for word; … marks text left out.',
    },
    {
      id: 's2',
      connector: 'web',
      kind: 'sample',
      url: 'https://m.gewinde-normen.de/en/npt-pipe-thread.html',
      title: 'NPT pipe thread',
      publisher: 'gewinde-normen.de',
      tier: 4,
      category: 'specialist',
      publishedAt: null,
      retrievedAt: RETRIEVED_AT,
      snippet: GEWINDE,
      contentHash: 'sample-fitting-2',
      license: null,
      note: 'A thread-standards reference site. Excerpts copied word for word; … marks text left out.',
    },
  ],
  core: {
    displayName: 'Brass pipe adapter, 1/2" (thread type unconfirmed)',
    subcategory: 'Threaded pipe adapter',
    summary:
      'A brass adapter that joins a threaded fitting to a pipe soldered into its sleeve. It is marked 1/2, but whether the thread is American (NPT) or British (BSP) cannot be told from this photo, and the two do not mix. One close photo of the thread would settle it.',
    identityStatus: 'candidates',
    topCandidate: NPT,
    findings: [
      { ref: 'a', section: 'identity', text: 'A brass part with a six-sided middle, an external thread at one end and a plain smooth sleeve at the other.', basis: 'observed', confidence: 0.93, regionIds: ['r1', 'r2', 'r3'], sourceIds: [], quote: null },
      { ref: 'b', section: 'identity', text: '"1/2" is stamped on one flat of the hex.', basis: 'observed', confidence: 0.95, regionIds: ['r4'], sourceIds: [], quote: null },
      { ref: 'c', section: 'identity', text: 'It is a pipe adapter: the thread screws into a fitting, and a pipe end is soldered into the sleeve.', basis: 'inferred', confidence: 0.7, regionIds: ['r2', 'r3'], sourceIds: [], quote: null },
      { ref: 'd', section: 'identity', text: 'The "1/2" is most likely a nominal pipe size, which does not match any measured diameter of the part.', basis: 'inferred', confidence: 0.78, regionIds: ['r4'], sourceIds: [], quote: null },
      { ref: 'e', section: 'identity', text: 'Whether the thread is American (NPT) or British (BSP) cannot be told from this photo.', basis: 'unknown', confidence: null, regionIds: ['r2'], sourceIds: [], quote: null },
      { ref: 'f', section: 'parts', text: 'The thread may narrow slightly towards its end, which would mean a tapered thread, but the photo is not sharp enough to be sure.', basis: 'hypothesis', confidence: 0.5, regionIds: ['r2'], sourceIds: [], quote: null },
      { ref: 'g', section: 'operation', text: 'NPT threads have pointed crests and a 60-degree thread angle.', basis: 'sourced', confidence: 0.9, regionIds: [], sourceIds: ['s1'], quote: 'NPT threads are pointed in the peaks and valleys with a 60-degree thread angle' },
      { ref: 'h', section: 'operation', text: 'BSP threads have rounded crests and a 55-degree thread angle.', basis: 'sourced', confidence: 0.9, regionIds: [], sourceIds: ['s1'], quote: 'BSP threads are rounded in the peaks and valleys and have a 55-degree thread angle' },
      { ref: 'i', section: 'operation', text: 'NPT is a tapered pipe thread that is sealed with a sealant compound.', basis: 'sourced', confidence: 0.85, regionIds: [], sourceIds: ['s2'], quote: 'American Taper Pipe Thread, with sealant compound.' },
      { ref: 'j', section: 'limits', text: 'BSP and NPT threads are not interchangeable, even though they can look alike at first glance.', basis: 'sourced', confidence: 0.9, regionIds: [], sourceIds: ['s1'], quote: 'they are not interchangeable' },
      { ref: 'k', section: 'limits', text: 'Counting threads will not tell them apart at this size: both standards usually have 14 threads per inch at 1/2".', basis: 'inferred', confidence: 0.75, regionIds: ['r2'], sourceIds: [], quote: null },
      { ref: 'l', section: 'materials', text: 'The yellow colour and machined finish suggest brass.', basis: 'inferred', confidence: 0.75, regionIds: ['r1'], sourceIds: [], quote: null },
      { ref: 'm', section: 'materials', text: 'Whether this brass is approved for drinking water cannot be told from a photo.', basis: 'unknown', confidence: null, regionIds: [], sourceIds: [], quote: null },
      { ref: 'n', section: 'failure', text: 'A joint between mismatched threads may feel tight at first and then weep or fail later.', basis: 'inferred', confidence: 0.7, regionIds: [], sourceIds: [], quote: null },
      { ref: 'o', section: 'care', text: 'Clean the thread before fitting, and use the sealant or tape that suits both the thread type and what flows through the pipe.', basis: 'inferred', confidence: 0.65, regionIds: ['r2'], sourceIds: [], quote: null },
    ],
    components: [
      { name: 'Hex body', role: 'Gives a spanner something to grip.', regionId: 'r1', material: 'Probably brass', parent: null, visibleInPhoto: true, basis: 'observed' },
      { name: 'External thread', role: 'Screws into a matching threaded fitting.', regionId: 'r2', material: null, parent: 'Hex body', visibleInPhoto: true, basis: 'observed' },
      { name: 'Solder cup', role: 'Takes a pipe end that is soldered in place.', regionId: 'r3', material: null, parent: 'Hex body', visibleInPhoto: true, basis: 'observed' },
      { name: 'Size stamp', role: 'Nominal size marking.', regionId: 'r4', material: null, parent: 'Hex body', visibleInPhoto: true, basis: 'observed' },
    ],
    conflicts: [],
    openQuestions: [
      'Photograph the thread side-on, as close as your camera focuses: rounded crests suggest BSP, sharp crests suggest NPT.',
      'Check the other flats for letters such as "NPT", "G", "R" or a country of origin.',
    ],
  },
  extras: {
    timeline: [],
    safety: [
      { hazard: 'pressure', severity: 'warning', text: 'Mismatched threads can leak and then fail under pressure.', advice: 'Confirm the thread type before fitting it to anything pressurised.', professionalReview: false, basis: 'sourced', confidence: 0.85, regionIds: [], sourceIds: ['s1'], quote: 'the dissimilar pitch will cause a misalignment of the threads leading to leakage and failure under pressure' },
      { hazard: 'gas', severity: 'danger', text: 'Sealed with PTFE tape, it is safe to use on a gas line.', advice: null, professionalReview: false, basis: 'inferred', confidence: 0.6, regionIds: [], sourceIds: [], quote: null },
      { hazard: 'gas', severity: 'danger', text: 'If this is for a gas supply, have it fitted by a qualified gas engineer, and do not guess the thread type.', advice: 'Many countries require gas work to be done by a registered professional.', professionalReview: true, basis: 'inferred', confidence: 0.85, regionIds: [], sourceIds: [], quote: null },
    ],
    related: [
      { name: 'Thread pitch gauge', relation: 'The tool that tells 55° from 60° threads', basis: 'inferred', confidence: 0.8, regionIds: [], sourceIds: [], quote: null },
      { name: 'Compression fitting', relation: 'Joins pipe without solder, using a nut and olive', basis: 'inferred', confidence: 0.8, regionIds: [], sourceIds: [], quote: null },
      { name: 'PTFE thread tape', relation: 'A common sealant for tapered threads', basis: 'inferred', confidence: 0.75, regionIds: [], sourceIds: [], quote: null },
    ],
    live: [],
    whatIf: [
      {
        title: 'How hard does the water push?',
        question: 'With household water pressure, how much force acts on the end of the pipe in this fitting?',
        kind: 'calculation',
        summary: 'Pressure times the area of the bore. The answer is small, which is why joints between mismatched threads tend to leak rather than blow apart.',
        assumptions: [
          { key: 'p', label: 'Water pressure', value: 3, unit: 'bar', min: 1, max: 10, step: 0.5, origin: 'assumed', note: 'Typical household supplies run at a few bar.' },
          { key: 'd', label: 'Bore diameter', value: 15, unit: 'mm', min: 8, max: 22, step: 0.5, origin: 'assumed', note: 'Measure the inside of the sleeve to replace this.' },
        ],
        steps: [
          { key: 'A', label: 'Bore area', expr: 'pi * (d / 1000) ^ 2 / 4', unit: 'm^2' },
          { key: 'F', label: 'Force on the pipe end', expr: 'p * 100000 * A', unit: 'N' },
        ],
        resultKey: 'F',
        sweepKey: 'p',
        caveats: ['Static pressure only. Water hammer can briefly reach several times this.', 'This says nothing about whether the thread will seal.'],
        safety: null,
        sourceIds: [],
      },
      {
        title: 'What if I screw it into the other thread type?',
        question: 'What happens if an NPT part is screwed into a BSP fitting, or the reverse?',
        kind: 'hypothesis',
        summary: 'The threads can start and even feel tight, because the forms look alike, but the angles and pitches do not match. The usual result is a slow leak that sealant hides for a while.',
        assumptions: [],
        steps: [],
        resultKey: null,
        sweepKey: null,
        caveats: ['An adapter made for joining the two standards is the right fix.'],
        safety: 'Never rely on extra tape or sealant to make mismatched threads hold on gas or pressurised lines.',
        sourceIds: ['s1'],
      },
    ],
  },
  resolve: {
    ranking: [
      { candidateName: NPT, likelihood: 0.45, evidenceFor: ['Slight taper is visible along the thread'], evidenceAgainst: [] },
      { candidateName: BSP, likelihood: 0.42, evidenceFor: ['BSP taper (BSPT) also narrows along its length'], evidenceAgainst: [] },
      { candidateName: COMPRESSION, likelihood: 0.03, evidenceFor: [], evidenceAgainst: ['The plain end has no external thread for a compression nut'] },
    ],
    nextShot: {
      instruction: 'Photograph the thread side-on against a bright background, as close as your camera will focus.',
      why: 'Rounded crests point to BSP (55°), sharp crests to NPT (60°). Counting threads will not help, because at 1/2" both usually have 14 per inch.',
      separates: [NPT, BSP],
      capture: 'detail',
      target: 'external thread',
      expectedGain: 0.6,
    },
    alternativeExplanations: ['A regional pipe standard where "1/2" is a trade size, not either of these two'],
    researchQuestions: ['Which thread standard does the plumbing this part came from use?'],
  },
  secondOpinion: {
    quality: { adequate: true, issues: [], advice: [] },
    objectCount: 1,
    primary: { description: 'Brass threaded fitting with a hex.', category: 'component', subcategory: 'Pipe fitting', hazards: ['pressure'] },
    candidates: [
      { name: BSP, category: 'component', likelihood: 0.5, evidenceFor: ['Hex fitting with a 1/2 marking'], evidenceAgainst: [], missing: [] },
      { name: NPT, category: 'component', likelihood: 0.4, evidenceFor: ['Tapered look'], evidenceAgainst: [], missing: [] },
    ],
    concepts: [],
    pointers: [],
    textRead: [{ text: '1/2', location: null }],
    retrievalQueries: [],
  },
  inside: {
    kind: 'structure',
    intro: 'A pipe adapter is a single machined piece of metal with a hole running through it. One end screws into a threaded fitting; the other takes a pipe that is soldered in place.',
    groups: [
      {
        name: 'Threaded end',
        role: 'Joins the adapter to a threaded fitting.',
        parts: [
          { name: 'External thread', what: 'Screws into a matching threaded fitting.', how: 'On a tapered pipe thread the fit gets tighter as it is screwed in, and a sealant fills the small gaps between the threads.', regionId: 'r2', visibleInPhoto: true, basis: 'sourced', confidence: 0.8, regionIds: ['r2'], sourceIds: ['s2'], quote: 'American Taper Pipe Thread, with sealant compound.' },
        ],
      },
      {
        name: 'Body',
        role: 'Holds the two ends together and carries the flow.',
        parts: [
          { name: 'Hex', what: 'Gives a spanner something to grip.', how: 'Its six flat faces let a spanner turn the part without slipping.', regionId: 'r1', visibleInPhoto: true, basis: 'inferred', confidence: 0.85, regionIds: ['r1'], sourceIds: [], quote: null },
          { name: 'Bore', what: 'Carries the water or gas through the part.', how: 'A smooth hole runs the full length, so the flow passes straight through.', regionId: null, visibleInPhoto: false, basis: 'inferred', confidence: 0.8, regionIds: [], sourceIds: [], quote: null },
          { name: 'Size stamp', what: 'Shows the nominal pipe size.', how: 'The number names a standard pipe size; it is not a measured diameter of this part.', regionId: 'r4', visibleInPhoto: true, basis: 'inferred', confidence: 0.75, regionIds: ['r4'], sourceIds: [], quote: null },
        ],
      },
      {
        name: 'Solder end',
        role: 'Joins the adapter to a copper pipe.',
        parts: [
          { name: 'Solder cup', what: 'Takes the end of the pipe.', how: 'The pipe slides in with a narrow gap; molten solder is drawn into the gap by capillary action and sets to seal and hold the joint.', regionId: 'r3', visibleInPhoto: true, basis: 'inferred', confidence: 0.75, regionIds: ['r3'], sourceIds: [], quote: null },
        ],
      },
    ],
    flows: [
      {
        title: 'How the flow passes through',
        summary: 'Water or gas enters through the threaded end, runs along the bore and leaves into the soldered pipe.',
        steps: [
          { label: 'Threaded fitting', detail: 'The flow arrives from the fitting the thread is screwed into.' },
          { label: 'Bore', detail: 'It passes straight through the hole in the middle of the adapter.' },
          { label: 'Soldered pipe', detail: 'It leaves into the pipe sealed inside the solder cup.' },
        ],
        basis: 'inferred',
        confidence: 0.75,
        regionIds: [],
        sourceIds: [],
        quote: null,
      },
    ],
    illustrationBrief: 'A cutaway of a brass pipe adapter with a hex body, a male thread at one end and a plain solder cup at the other, showing the bore running through.',
  },
  questions: [
    {
      q: 'Can I use it on my gas cooker?',
      segments: [
        { text: 'Whether this part is suitable for gas cannot be told from a photo, and the thread type is not yet known.', basis: 'unknown', confidence: null, regionIds: ['r2'], sourceIds: [], quote: null },
        { text: 'Mismatched threads can leak under pressure, which on a gas line is dangerous.', basis: 'inferred', confidence: 0.8, regionIds: [], sourceIds: ['s1'], quote: null },
        { text: 'Have a qualified gas engineer fit any gas connection.', basis: 'inferred', confidence: 0.85, regionIds: [], sourceIds: [], quote: null },
      ],
    },
    {
      q: 'How do I tell NPT from BSP without a gauge?',
      segments: [
        { text: 'Look at the crests of the thread under good light: NPT crests are pointed, BSP crests are rounded.', basis: 'sourced', confidence: 0.85, regionIds: ['r2'], sourceIds: ['s1'], quote: 'NPT threads are pointed in the peaks and valleys with a 60-degree thread angle' },
        { text: 'Counting threads per inch will not help at 1/2", where both usually have 14.', basis: 'inferred', confidence: 0.75, regionIds: [], sourceIds: [], quote: null },
        { text: 'If you can, try it by hand in a fitting whose type you know: a matching thread turns smoothly for several turns before it tightens.', basis: 'inferred', confidence: 0.6, regionIds: [], sourceIds: [], quote: null },
      ],
    },
  ],
};
