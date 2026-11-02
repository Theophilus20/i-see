import type { Finding, Region, Source, WhatIf } from '../src/shared/schema';

export const NOW = '2026-10-28T10:00:00.000Z';

export function src(over: Partial<Source> = {}): Source {
  return {
    id: 's1',
    connector: 'wikipedia',
    kind: 'connector',
    url: 'https://en.wikipedia.org/wiki/Moka_pot',
    title: 'Moka pot',
    publisher: 'Wikipedia',
    tier: 3,
    category: 'community',
    publishedAt: null,
    retrievedAt: NOW,
    snippet:
      'The moka pot is a stove-top coffee maker that produces coffee by passing boiling water pressurised by steam through ground coffee. It was invented by Luigi De Ponti for Alfonso Bialetti in 1933.',
    contentHash: 'abc',
    license: 'CC BY-SA 4.0',
    note: null,
    ...over,
  };
}

export function region(over: Partial<Region> = {}): Region {
  return {
    id: 'r1',
    label: 'whole object',
    kind: 'mask',
    source: 'sam',
    view: 0,
    box: { x: 10, y: 10, w: 100, h: 100 },
    path: 'M10 10H110V110H10Z',
    anchor: { x: 60, y: 60 },
    area: 0.4,
    confidence: 0.9,
    ...over,
  };
}

export function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    section: 'identity',
    text: 'A stove-top coffee maker with an octagonal body.',
    basis: 'observed',
    confidence: 0.9,
    regionIds: ['r1'],
    sourceIds: [],
    quote: null,
    verification: { status: 'unverified', notes: [] },
    recheckAfter: null,
    flags: [],
    origin: 'model',
    disputed: false,
    note: null,
    ...over,
  };
}

export function heatingWhatIf(over: Partial<WhatIf> = {}): WhatIf {
  return {
    id: 'w1',
    title: 'How long to heat the water?',
    question: 'How long would the water take to reach brewing temperature?',
    kind: 'calculation',
    summary: 'Energy needed divided by the power that reaches the water.',
    assumptions: [
      { key: 'm', label: 'Water mass', value: 0.3, unit: 'kg', min: 0.05, max: 0.6, step: 0.05, origin: 'assumed', note: null },
      { key: 'c', label: 'Specific heat of water', value: 4186, unit: 'J/(kg*K)', min: 4000, max: 4300, step: 10, origin: 'sourced', note: null },
      { key: 'dT', label: 'Temperature rise', value: 75, unit: 'K', min: 40, max: 80, step: 1, origin: 'assumed', note: null },
      { key: 'P', label: 'Burner power', value: 1500, unit: 'W', min: 500, max: 3000, step: 50, origin: 'assumed', note: null },
      { key: 'eta', label: 'Share reaching the water', value: 0.4, unit: '', min: 0.1, max: 0.9, step: 0.05, origin: 'assumed', note: null },
    ],
    steps: [
      { key: 'Q', label: 'Heat needed', expr: 'm * c * dT', unit: 'J' },
      { key: 't', label: 'Time', expr: 'Q / (P * eta) / 60', unit: 'min' },
    ],
    resultKey: 't',
    sweepKey: 'P',
    caveats: [],
    safety: null,
    sourceIds: [],
    ...over,
  };
}
