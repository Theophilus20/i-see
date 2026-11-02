/**
 * Procedural specimens.
 *
 * Two objects modelled from simple geometry so the preview has real pixels to look at
 * and exact outlines to point at, without shipping anyone's photograph:
 *
 *  - `moka-pot`       an eight-sided stove-top coffee maker, with the hidden parts
 *                      (funnel, filter plate, gasket) modelled too so the Inside view
 *                      can explode it
 *  - `brass-fitting`  a deliberately ambiguous brass pipe fitting: hex body stamped
 *                      "1/2", a male thread on one end, a smooth socket on the other
 *
 * Units are metres. Every mesh carries `userData.part`; every part is a child Group
 * named after its id, with `userData.explode` giving its offset in an exploded view.
 * Pure geometry: no DOM, so it runs in the app, in tests and in the headless renderer.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type SpecimenId = 'moka-pot' | 'brass-fitting';
export const SPECIMEN_IDS: readonly SpecimenId[] = ['moka-pot', 'brass-fitting'];

export interface SpecimenPart {
  id: string;
  label: string;
  /** Offset in metres when fully exploded. */
  explode: [number, number, number];
  /** False for parts that cannot be seen when the object is assembled. */
  visibleAssembled: boolean;
}

export const SPECIMEN_PARTS: Record<SpecimenId, SpecimenPart[]> = {
  'moka-pot': [
    { id: 'boiler', label: 'Water chamber (boiler)', explode: [0, -0.06, 0], visibleAssembled: true },
    { id: 'valve', label: 'Safety valve', explode: [0, -0.06, 0.035], visibleAssembled: true },
    { id: 'funnel', label: 'Filter funnel (coffee basket)', explode: [0, 0.035, 0], visibleAssembled: false },
    { id: 'filter', label: 'Upper filter plate', explode: [0, 0.085, 0], visibleAssembled: false },
    { id: 'gasket', label: 'Rubber gasket', explode: [0, 0.1, 0], visibleAssembled: false },
    { id: 'collector', label: 'Coffee collector (upper chamber)', explode: [0, 0.135, 0], visibleAssembled: true },
    { id: 'spout', label: 'Pouring spout', explode: [0, 0.135, 0], visibleAssembled: true },
    { id: 'lid', label: 'Hinged lid', explode: [0, 0.185, 0], visibleAssembled: true },
    { id: 'knob', label: 'Lid knob', explode: [0, 0.205, 0], visibleAssembled: true },
    { id: 'handle', label: 'Handle', explode: [-0.035, 0.135, 0], visibleAssembled: true },
  ],
  'brass-fitting': [
    { id: 'hex', label: 'Hex body (spanner flats)', explode: [0, 0, 0], visibleAssembled: true },
    { id: 'marking', label: 'Stamped marking "1/2"', explode: [0, 0.012, 0], visibleAssembled: true },
    { id: 'thread', label: 'Male thread', explode: [0.025, 0, 0], visibleAssembled: true },
    { id: 'cup', label: 'Smooth socket (possible solder cup)', explode: [-0.025, 0, 0], visibleAssembled: true },
  ],
};

// ---------------------------------------------------------------------------
// Deterministic noise for surface textures
// ---------------------------------------------------------------------------

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Roughness map: fine streaks along U (machining or brushing marks) over a soft, blotchy
 * low-frequency variation, so large flat areas do not read as computer-perfect.
 * Values sit near 1 so the map modulates the material's roughness.
 */
function streakTexture(seed: number, size = 256, strength = 0.25): THREE.DataTexture {
  const r = rng(seed);
  const data = new Uint8Array(size * size * 4);
  const rows = new Float32Array(size);
  for (let y = 0; y < size; y++) rows[y] = r();
  // smooth the row noise a little so streaks have width variation
  const smooth = new Float32Array(size);
  for (let y = 0; y < size; y++) smooth[y] = (rows[y]! * 2 + rows[(y + 1) % size]! + rows[(y + size - 1) % size]!) / 4;
  const waves = Array.from({ length: 4 }, () => ({ fx: 1 + Math.floor(r() * 3), fy: 1 + Math.floor(r() * 3), ph: r() * Math.PI * 2 }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let low = 0;
      for (const w of waves) low += Math.sin(((x * w.fx + y * w.fy) / size) * Math.PI * 2 + w.ph);
      low = low / 8 + 0.5;
      const v = 1 - strength * (0.45 * smooth[y]! + 0.15 * r() + 0.4 * low);
      const b = Math.round(255 * Math.max(0, Math.min(1, v)));
      const i = (y * size + x) * 4;
      data[i] = b;
      data[i + 1] = b;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

type Profile = Array<[number, number]>; // [apothem, y], ordered so the outside is on the right when walking it

/**
 * A lathe with flat facets: crisp edges between facets, smooth shading along the profile.
 * `rotation` sets the angle of the first facet's centre, measured from +X towards +Z.
 */
export function facetedLathe(profile: Profile, sides: number, rotation = 0, bevel = 0.1): THREE.BufferGeometry {
  // Each facet is three strips: a narrow strip at each edge whose normals blend into the
  // neighbouring facet (a shading-only bevel, like a softened cast edge), and the flat middle.
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const half = Math.PI / sides;
  const k = 1 / Math.cos(half);
  const lens = [0];
  for (let i = 1; i < profile.length; i++) {
    const [a0, y0] = profile[i - 1]!;
    const [a1, y1] = profile[i]!;
    lens.push(lens[i - 1]! + Math.hypot(a1 - a0, y1 - y0));
  }
  const total = lens[lens.length - 1] || 1;
  const n2 = profile.map((_, i) => {
    const [aPrev, yPrev] = profile[Math.max(0, i - 1)]!;
    const [aNext, yNext] = profile[Math.min(profile.length - 1, i + 1)]!;
    const da = aNext - aPrev;
    const dy = yNext - yPrev;
    const l = Math.hypot(da, dy) || 1;
    return [dy / l, -da / l] as const;
  });
  // positions across a facet as fractions from the left corner (0) to the right corner (1)
  const cols = bevel > 0 ? [0, bevel, 1 - bevel, 1] : [0, 1];
  const ncols = cols.length;
  for (let f = 0; f < sides; f++) {
    const phi = rotation + (f * 2 * Math.PI) / sides;
    const base = pos.length / 3;
    const L = phi - half;
    const Rr = phi + half;
    for (let i = 0; i < profile.length; i++) {
      const [a, y] = profile[i]!;
      const R = a * k;
      const [nr, ny] = n2[i]!;
      const lx = R * Math.cos(L);
      const lz = R * Math.sin(L);
      const rx = R * Math.cos(Rr);
      const rz = R * Math.sin(Rr);
      for (let c = 0; c < ncols; c++) {
        const t = cols[c]!;
        pos.push(lx + (rx - lx) * t, y, lz + (rz - lz) * t);
        // normal direction: corners use the bisector of the two facets
        const ang = c === 0 ? L : c === ncols - 1 ? Rr : phi;
        nor.push(nr * Math.cos(ang), ny, nr * Math.sin(ang));
        uv.push((f + t) / sides, lens[i]! / total);
      }
    }
    for (let i = 0; i < profile.length - 1; i++) {
      for (let c = 0; c < ncols - 1; c++) {
        const L0 = base + i * ncols + c;
        const R0 = L0 + 1;
        const L1 = L0 + ncols;
        const R1 = L1 + 1;
        idx.push(L0, L1, R1, L0, R1, R0);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nArr = new Float32Array(nor);
  for (let i = 0; i < nArr.length; i += 3) {
    const l = Math.hypot(nArr[i]!, nArr[i + 1]!, nArr[i + 2]!) || 1;
    nArr[i]! /= l;
    nArr[i + 1]! /= l;
    nArr[i + 2]! /= l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nArr, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Flat polygon cap for a faceted lathe, facing up (+Y) or down. */
function facetedCap(apothem: number, y: number, sides: number, rotation: number, up: boolean): THREE.BufferGeometry {
  const R = apothem / Math.cos(Math.PI / sides);
  const pos: number[] = [0, y, 0];
  const nor: number[] = [0, up ? 1 : -1, 0];
  const uv: number[] = [0.5, 0.5];
  for (let f = 0; f < sides; f++) {
    const ang = rotation + (f * 2 * Math.PI) / sides + Math.PI / sides;
    pos.push(R * Math.cos(ang), y, R * Math.sin(ang));
    nor.push(0, up ? 1 : -1, 0);
    uv.push(0.5 + 0.5 * Math.cos(ang), 0.5 + 0.5 * Math.sin(ang));
  }
  const idx: number[] = [];
  for (let f = 0; f < sides; f++) {
    const a = 1 + f;
    const b = 1 + ((f + 1) % sides);
    // corners advance from +X towards +Z; seen from above (+Y) that is clockwise, so flip for up
    if (up) idx.push(0, b, a);
    else idx.push(0, a, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Smooth lathe from [radius, y] pairs, outside on the right. */
function smoothLathe(profile: Profile, segments = 48): THREE.BufferGeometry {
  // THREE.LatheGeometry sweeps x = r*sin(phi), z = r*cos(phi); its faces point outward for profiles ordered bottom to top.
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

/**
 * A screw thread along +Y: rounded-crest Whitworth-like profile, chamfered at the free end.
 * Indexed with a wrapped seam so shading is continuous.
 */
function threadGeometry(o: { rMajor: number; depth: number; pitch: number; length: number; chamfer: number; radial?: number }): THREE.BufferGeometry {
  const radial = o.radial ?? 144;
  const rows = Math.ceil((o.length / o.pitch) * 28);
  const rMinor = o.rMajor - o.depth;
  const pos: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const y = (o.length * i) / rows;
    for (let j = 0; j < radial; j++) {
      const th = (2 * Math.PI * j) / radial;
      let ph = y / o.pitch - j / radial;
      ph -= Math.floor(ph);
      const tooth = 1 - Math.abs(2 * ph - 1); // 0 root, 1 crest
      const shaped = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, tooth * 1.12));
      let r = rMinor + o.depth * shaped;
      const fromEnd = o.length - y;
      if (fromEnd < o.chamfer) r = Math.min(r, rMinor - 0.0002 + fromEnd * (o.depth / o.chamfer) * 1.1);
      const fromStart = y;
      if (fromStart < o.pitch * 0.6) r = Math.min(r, rMinor + o.depth * (fromStart / (o.pitch * 0.6)) * 0.4 + 0.00005);
      pos.push(r * Math.cos(th), y, r * Math.sin(th));
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      idx.push(a, c, d, a, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flat ring in the XZ plane at height y, facing up or down. */
function ring(rIn: number, rOut: number, y: number, up: boolean, segments = 96): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(rIn, rOut, segments, 1);
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

/** Hexagonal end face with a round hole, matching facetedLathe(…, 6, 0), at height y. */
function hexAnnulus(apothem: number, rHole: number, y: number, up: boolean): THREE.BufferGeometry {
  const R = apothem / Math.cos(Math.PI / 6);
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    if (i === 0) shape.moveTo(R * Math.cos(a), R * Math.sin(a));
    else shape.lineTo(R * Math.cos(a), R * Math.sin(a));
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, rHole, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const g = new THREE.ShapeGeometry(shape, 48);
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

/** Open tube seen from the inside (bores). */
function bore(r: number, y0: number, y1: number, segments = 96): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, segments, 1, true);
  g.translate(0, (y0 + y1) / 2, 0);
  // flip faces to point inwards
  const index = g.getIndex()!;
  const arr = index.array as Uint16Array | Uint32Array;
  for (let i = 0; i < arr.length; i += 3) {
    const t = arr[i + 1]!;
    arr[i + 1] = arr[i + 2]!;
    arr[i + 2] = t;
  }
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

/** Text drawn as strokes of small boxes with round joints, lying flat (normal +Y), reading along +X with "up" towards -Z. */
function strokeText(
  glyphs: Array<{ strokes: Array<Array<[number, number]>>; advance: number }>,
  o: { height: number; stroke: number; depth: number; y: number; cx: number; cz: number },
): THREE.BufferGeometry {
  const total = glyphs.reduce((a, g) => a + g.advance, 0) * o.height;
  let pen = o.cx - total / 2;
  const parts: THREE.BufferGeometry[] = [];
  const toWorld = (u: number, v: number): THREE.Vector3 => new THREE.Vector3(pen + u * o.height, o.y, o.cz + o.height / 2 - v * o.height);
  for (const g of glyphs) {
    for (const s of g.strokes) {
      for (let i = 0; i < s.length; i++) {
        const p = toWorld(s[i]![0], s[i]![1]);
        const disc = new THREE.CylinderGeometry((o.stroke * o.height) / 2, (o.stroke * o.height) / 2, o.depth, 16);
        disc.translate(p.x, p.y + o.depth / 2, p.z);
        parts.push(disc);
        if (i === 0) continue;
        const q = toWorld(s[i - 1]![0], s[i - 1]![1]);
        const len = p.distanceTo(q);
        const box = new THREE.BoxGeometry(len, o.depth, o.stroke * o.height);
        box.rotateY(-Math.atan2(p.z - q.z, p.x - q.x));
        box.translate((p.x + q.x) / 2, p.y + o.depth / 2, (p.z + q.z) / 2);
        parts.push(box);
      }
    }
    pen += g.advance * o.height;
  }
  const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
  parts.forEach((p) => p.dispose());
  return merged;
}

function arc(cx: number, cy: number, r: number, from: number, to: number, steps: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

const GLYPHS = {
  one: { strokes: [[[0.06, 0.76], [0.25, 1.0], [0.25, 0.0]], [[0.04, 0.0], [0.46, 0.0]]] as Array<Array<[number, number]>>, advance: 0.56 },
  slash: { strokes: [[[0.02, -0.04], [0.4, 1.04]]] as Array<Array<[number, number]>>, advance: 0.5 },
  two: { strokes: [[...arc(0.29, 0.71, 0.26, 165, -32, 14), [0.03, 0.0], [0.6, 0.0]]] as Array<Array<[number, number]>>, advance: 0.62 },
};

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

function materials() {
  const alu = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#b9bcbf'),
    metalness: 1,
    roughness: 0.34,
    roughnessMap: streakTexture(11, 256, 0.22),
    anisotropy: 0.25,
  });
  (alu.roughnessMap as THREE.Texture).repeat.set(4, 2);
  const aluInner = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5d6064'), metalness: 0.9, roughness: 0.6 });
  const bakelite = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#1b1a19'),
    metalness: 0,
    roughness: 0.5,
    clearcoat: 0.12,
    clearcoatRoughness: 0.5,
  });
  const steelBrass = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#b9a274'), metalness: 1, roughness: 0.3 });
  const rubber = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1e1c1b'), metalness: 0, roughness: 0.92 });
  const brass = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#b8934f'),
    metalness: 1,
    roughness: 0.3,
    roughnessMap: streakTexture(23, 256, 0.3),
    anisotropy: 0.4,
  });
  (brass.roughnessMap as THREE.Texture).repeat.set(1, 6);
  const brassThread = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#b18d4a'), metalness: 1, roughness: 0.36 });
  const brassInner = new THREE.MeshStandardMaterial({ color: new THREE.Color('#4a3618'), metalness: 0.85, roughness: 0.62, side: THREE.FrontSide });
  const stamp = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3f2f14'), metalness: 0.6, roughness: 0.78 });
  return { alu, aluInner, bakelite, steelBrass, rubber, brass, brassThread, brassInner, stamp };
}

function part(id: string, specimen: SpecimenId, meshes: Array<[THREE.BufferGeometry, THREE.Material]>): THREE.Group {
  const meta = SPECIMEN_PARTS[specimen].find((p) => p.id === id)!;
  const g = new THREE.Group();
  g.name = id;
  g.userData = { part: id, label: meta.label, explode: meta.explode, visibleAssembled: meta.visibleAssembled };
  for (const [geo, mat] of meshes) {
    const m = new THREE.Mesh(geo, mat);
    m.userData.part = id;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Moka pot (about a 3-cup size: 21 cm tall)
// ---------------------------------------------------------------------------

const OCT = 8;
const OCT_ROT = Math.PI / 2; // a facet faces +Z (where the valve sits); +X and -X are facets too

function buildMoka(): THREE.Group {
  const M = materials();
  const root = new THREE.Group();
  root.name = 'moka-pot';

  // Boiler: wide at the base, narrowing to the screw joint.
  const boilerProfile: Profile = [
    [0.0465, 0.0],
    [0.0502, 0.0028],
    [0.0511, 0.009],
    [0.0505, 0.022],
    [0.0488, 0.042],
    [0.0462, 0.06],
    [0.0436, 0.072],
    [0.0425, 0.078],
  ];
  root.add(
    part('boiler', 'moka-pot', [
      [facetedLathe(boilerProfile, OCT, OCT_ROT), M.alu],
      [facetedCap(0.0465, 0.0, OCT, OCT_ROT, false), M.alu],
      [facetedCap(0.0425, 0.078, OCT, OCT_ROT, true), M.aluInner],
    ]),
  );

  // Safety valve on the +Z facet.
  {
    const y = 0.043;
    const a = 0.0487;
    const nut = new THREE.CylinderGeometry(0.0058, 0.0058, 0.0042, 6);
    nut.rotateX(Math.PI / 2);
    nut.translate(0, y, a + 0.0021);
    const body = new THREE.CylinderGeometry(0.0038, 0.0042, 0.0032, 32);
    body.rotateX(Math.PI / 2);
    body.translate(0, y, a + 0.0042 + 0.0016);
    const cap = new THREE.SphereGeometry(0.0038, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.55, 1);
    cap.rotateX(Math.PI / 2);
    cap.translate(0, y, a + 0.0074);
    const pin = new THREE.CylinderGeometry(0.0011, 0.0011, 0.0024, 16);
    pin.rotateX(Math.PI / 2);
    pin.translate(0, y, a + 0.0088);
    root.add(part('valve', 'moka-pot', [[nut, M.steelBrass], [body, M.steelBrass], [cap, M.steelBrass], [pin, M.steelBrass]]));
  }

  // Funnel: basket sitting in the boiler mouth, with a stem down to near the bottom.
  root.add(
    part('funnel', 'moka-pot', [
      [
        smoothLathe([
          [0.0055, 0.006],
          [0.0062, 0.05],
          [0.012, 0.054],
          [0.033, 0.058],
          [0.0345, 0.077],
          [0.0395, 0.0785],
          [0.0395, 0.0805],
        ]),
        M.alu,
      ],
      [ring(0.0, 0.0345, 0.0775, true, 64), M.aluInner],
    ]),
  );

  // Filter plate with holes, and the gasket around it.
  {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 0.0345, 0, Math.PI * 2, false);
    const holes: number[][] = [];
    for (let r = 0.004; r < 0.031; r += 0.0045) {
      const n = Math.max(1, Math.round((2 * Math.PI * r) / 0.0042));
      for (let i = 0; i < n; i++) holes.push([r * Math.cos((i / n) * 2 * Math.PI), r * Math.sin((i / n) * 2 * Math.PI)]);
    }
    holes.push([0, 0]);
    for (const [x, y] of holes) {
      const h = new THREE.Path();
      h.absarc(x!, y!, 0.0008, 0, Math.PI * 2, true);
      shape.holes.push(h);
    }
    const plate = new THREE.ShapeGeometry(shape, 8);
    plate.rotateX(-Math.PI / 2);
    plate.translate(0, 0.0812, 0);
    const plateUnder = plate.clone();
    plateUnder.rotateX(Math.PI);
    plateUnder.translate(0, 0.1624, 0);
    root.add(part('filter', 'moka-pot', [[plate, M.alu], [plateUnder, M.alu]]));
    const gasket = new THREE.TorusGeometry(0.0378, 0.0026, 12, 64);
    gasket.rotateX(Math.PI / 2);
    gasket.scale(1, 0.7, 1);
    gasket.translate(0, 0.0822, 0);
    root.add(part('gasket', 'moka-pot', [[gasket, M.rubber]]));
  }

  // Collector: skirt over the joint, a waist, flaring to the rim.
  const collectorProfile: Profile = [
    [0.0441, 0.0765],
    [0.0447, 0.0782],
    [0.0449, 0.0868],
    [0.0441, 0.0884],
    [0.0412, 0.0905],
    [0.0405, 0.096],
    [0.0414, 0.112],
    [0.0433, 0.135],
    [0.0452, 0.158],
    [0.0463, 0.172],
    [0.0476, 0.1755],
    [0.0478, 0.178],
  ];
  root.add(
    part('collector', 'moka-pot', [
      [facetedLathe(collectorProfile, OCT, OCT_ROT), M.alu],
      [facetedCap(0.0441, 0.0765, OCT, OCT_ROT, false), M.aluInner],
    ]),
  );

  // Spout: a pointed beak on the +X facet, top edge level with the rim.
  {
    const a = 0.0474; // apothem at the top
    const halfW = a * Math.tan(Math.PI / OCT) * 0.92;
    const yTop = 0.1778;
    const yBot = 0.146;
    const tip = new THREE.Vector3(a + 0.0205, yTop + 0.0012, 0);
    const tl = new THREE.Vector3(a - 0.0006, yTop, -halfW);
    const tr = new THREE.Vector3(a - 0.0006, yTop, halfW);
    const b = new THREE.Vector3(a - 0.003, yBot, 0);
    const bl = new THREE.Vector3(a - 0.0012, yTop - 0.012, -halfW * 0.98);
    const br = new THREE.Vector3(a - 0.0012, yTop - 0.012, halfW * 0.98);
    const tris: THREE.Vector3[][] = [
      [tl, tip, tr], // top
      [tl, bl, tip], // side -Z
      [tr, tip, br], // side +Z
      [bl, b, tip],
      [br, tip, b],
    ];
    const pos: number[] = [];
    for (const t of tris) for (const v of t) pos.push(v.x, v.y, v.z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    // make faces point outward regardless of the order above
    const p = g.getAttribute('position');
    const centre = new THREE.Vector3(a, yTop - 0.01, 0);
    for (let i = 0; i < p.count; i += 3) {
      const A = new THREE.Vector3().fromBufferAttribute(p, i);
      const B = new THREE.Vector3().fromBufferAttribute(p, i + 1);
      const C = new THREE.Vector3().fromBufferAttribute(p, i + 2);
      const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
      const mid = A.clone().add(B).add(C).divideScalar(3);
      if (n.dot(mid.sub(centre)) < 0) {
        p.setXYZ(i + 1, C.x, C.y, C.z);
        p.setXYZ(i + 2, B.x, B.y, B.z);
      }
    }
    g.computeVertexNormals();
    root.add(part('spout', 'moka-pot', [[g, M.alu]]));
  }

  // Lid: shallow eight-sided dome, slightly proud of the rim, with a hinge barrel on the handle side.
  {
    const lidProfile: Profile = [
      [0.0484, 0.1772],
      [0.0487, 0.1786],
      [0.0478, 0.1802],
      [0.04, 0.1838],
      [0.025, 0.1885],
      [0.0105, 0.1912],
      [0.0, 0.1918],
    ];
    const hinge = new THREE.CylinderGeometry(0.0028, 0.0028, 0.016, 24);
    hinge.rotateX(Math.PI / 2);
    hinge.translate(-0.0505, 0.1792, 0);
    const tab = new THREE.BoxGeometry(0.008, 0.0016, 0.014);
    tab.translate(-0.0468, 0.1792, 0);
    root.add(
      part('lid', 'moka-pot', [
        [facetedLathe(lidProfile, OCT, OCT_ROT), M.alu],
        [facetedCap(0.0484, 0.1772, OCT, OCT_ROT, false), M.aluInner],
        [hinge, M.alu],
        [tab, M.alu],
      ]),
    );
  }

  // Knob.
  root.add(
    part('knob', 'moka-pot', [
      [
        facetedLathe(
          [
            [0.0068, 0.1905],
            [0.0082, 0.1925],
            [0.0089, 0.1965],
            [0.0084, 0.2005],
            [0.0066, 0.2032],
            [0.0035, 0.2045],
            [0.0, 0.2048],
          ],
          OCT,
          OCT_ROT,
        ),
        M.bakelite,
      ],
    ]),
  );

  // Handle: angular, chunky, on the -X side, attached under the rim and at the waist.
  {
    const s = new THREE.Shape();
    // u: outward distance from the body; y: height
    const pts: Array<[number, number]> = [
      [-0.002, 0.1715],
      [0.012, 0.1745],
      [0.044, 0.1735],
      [0.0545, 0.1665],
      [0.0545, 0.158],
      [0.0475, 0.106],
      [0.0425, 0.0985],
      [0.0355, 0.1],
      [0.0345, 0.106],
      [0.0405, 0.152],
      [0.0365, 0.1575],
      [0.012, 0.1585],
      [-0.002, 0.155],
    ];
    s.moveTo(pts[0]![0], pts[0]![1]);
    for (const [u, y] of pts.slice(1)) s.lineTo(u, y);
    s.closePath();
    const depth = 0.0135;
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.0016, bevelSize: 0.0014, bevelSegments: 3, curveSegments: 4 });
    g.translate(0, 0, -depth / 2);
    // map u to -X, starting just inside the body surface
    g.scale(-1, 1, 1);
    g.translate(-0.0445, 0, 0);
    // scale(-1) flipped winding: restore it
    const index = g.getIndex();
    if (index) {
      const arr = index.array as Uint16Array | Uint32Array;
      for (let i = 0; i < arr.length; i += 3) {
        const t = arr[i + 1]!;
        arr[i + 1] = arr[i + 2]!;
        arr[i + 2] = t;
      }
    } else {
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i += 3) {
        const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
        p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
        p.setXYZ(i + 2, x, y, z);
      }
    }
    g.computeVertexNormals();
    root.add(part('handle', 'moka-pot', [[g, M.bakelite]]));
  }

  return root;
}

// ---------------------------------------------------------------------------
// Brass fitting (1/2-inch class: 27 mm across the flats, about 46 mm long)
// ---------------------------------------------------------------------------

function buildFitting(): THREE.Group {
  const M = materials();
  const root = new THREE.Group();
  root.name = 'brass-fitting';
  const AF = 0.027; // across flats
  const ap = AF / 2;
  const hexLen = 0.0135;
  const threadLen = 0.0145;
  const cupLen = 0.0165;
  const boreThread = 0.0072;
  const boreCup = 0.00795;

  // Everything is built along +Y and then laid along +X.
  // Hex with chamfered ends; a flat faces +Y after laying down.
  const h0 = -hexLen / 2;
  const h1 = hexLen / 2;
  const c = 0.0011;
  const hexProfile: Profile = [
    [ap - c * 1.2, h0],
    [ap, h0 + c],
    [ap, h1 - c],
    [ap - c * 1.2, h1],
  ];
  const hexMeshes: Array<[THREE.BufferGeometry, THREE.Material]> = [
    [facetedLathe(hexProfile, 6, 0), M.brass],
    [hexAnnulus(ap - c * 1.2, 0.0104, h1, true), M.brass],
    [hexAnnulus(ap - c * 1.2, 0.0104, h0, false), M.brass],
  ];

  // Thread on +Y end.
  const thread = threadGeometry({ rMajor: 0.01048, depth: 0.00116, pitch: 0.001814, length: threadLen, chamfer: 0.0016 });
  thread.translate(0, h1, 0);
  const threadEnd = ring(boreThread, 0.0088, h1 + threadLen, true);
  const threadBore = bore(boreThread, h1 - 0.004, h1 + threadLen);
  const neck = smoothLathe(
    [
      [0.0106, h1 - 0.0001],
      [0.0098, h1 + 0.0004],
      [0.0094, h1 + 0.0012],
    ],
    96,
  );

  // Smooth socket on -Y end.
  const cupOuter = smoothLathe(
    [
      [0.0109, h0 - cupLen],
      [0.0112, h0 - cupLen + 0.0006],
      [0.0112, h0 - 0.0018],
      [0.0108, h0 - 0.0008],
      [0.0108, h0 + 0.0001],
    ],
    128,
  );
  const cupEnd = ring(boreCup, 0.0109, h0 - cupLen, false);
  const cupBore = bore(boreCup, h0 - cupLen, h0 - 0.0025);
  const shoulder = ring(boreThread, boreCup, h0 - 0.0025, true);
  const innerBore = bore(boreThread, h0 - 0.0026, h1 - 0.0039);

  const threadPart = new THREE.Group();
  const cupPart = new THREE.Group();
  const add = (grp: THREE.Group, id: string, geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(geo, mat);
    m.userData.part = id;
    m.castShadow = true;
    m.receiveShadow = true;
    grp.add(m);
  };
  add(threadPart, 'thread', thread, M.brassThread);
  add(threadPart, 'thread', threadEnd, M.brass);
  add(threadPart, 'thread', threadBore, M.brassInner);
  add(threadPart, 'thread', neck, M.brassThread);
  add(cupPart, 'cup', cupOuter, M.brass);
  add(cupPart, 'cup', cupEnd, M.brass);
  add(cupPart, 'cup', cupBore, M.brassInner);
  add(cupPart, 'cup', shoulder, M.brassInner);
  add(cupPart, 'hex', innerBore, M.brassInner);

  // Lay each part group along X, keeping part groups as direct children of the root.
  const lay = (grp: THREE.Group, id: string) => {
    const meta = SPECIMEN_PARTS['brass-fitting'].find((p) => p.id === id)!;
    const outer = new THREE.Group();
    outer.name = id;
    outer.userData = { part: id, label: meta.label, explode: meta.explode, visibleAssembled: true };
    grp.rotation.z = -Math.PI / 2;
    outer.add(grp);
    root.add(outer);
    return outer;
  };
  const hexGrp = new THREE.Group();
  hexMeshes.forEach(([g, m]) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.userData.part = 'hex';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    hexGrp.add(mesh);
  });
  // the inner bore through the hex belongs to the hex
  const ib = cupPart.children.find((m) => m.userData.part === 'hex')!;
  cupPart.remove(ib);
  hexGrp.add(ib);
  lay(hexGrp, 'hex');
  lay(threadPart, 'thread');
  lay(cupPart, 'cup');

  // Stamped "1/2" on the top flat, reading along the axis.
  const text = strokeText([GLYPHS.one, GLYPHS.slash, GLYPHS.two], {
    height: 0.0052,
    stroke: 0.13,
    depth: 0.00006,
    y: ap + 0.00001,
    cx: 0.0004,
    cz: 0.0,
  });
  const markMeta = SPECIMEN_PARTS['brass-fitting'].find((p) => p.id === 'marking')!;
  const marking = new THREE.Group();
  marking.name = 'marking';
  marking.userData = { part: 'marking', label: markMeta.label, explode: markMeta.explode, visibleAssembled: true };
  const mm = new THREE.Mesh(text, M.stamp);
  mm.userData.part = 'marking';
  mm.receiveShadow = true;
  marking.add(mm);
  root.add(marking);

  // Rest on the bottom flat.
  root.position.y = ap;
  return root;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** A fresh Group for the specimen. Parts are direct children named by part id. */
export function buildSpecimen(id: SpecimenId): THREE.Group {
  const g = id === 'moka-pot' ? buildMoka() : buildFitting();
  g.userData.specimen = id;
  return g;
}

/** Move parts towards their exploded positions. t = 0 assembled, 1 fully exploded. */
export function explodeSpecimen(group: THREE.Group, t: number): void {
  for (const child of group.children) {
    const e = child.userData.explode as [number, number, number] | undefined;
    if (!e) continue;
    if (!child.userData.home) child.userData.home = child.position.clone();
    const home = child.userData.home as THREE.Vector3;
    child.position.set(home.x + e[0] * t, home.y + e[1] * t, home.z + e[2] * t);
  }
}

/** Bounding box of the assembled specimen, in metres. */
export function specimenBounds(group: THREE.Group): THREE.Box3 {
  return new THREE.Box3().setFromObject(group);
}

export function disposeSpecimen(group: THREE.Group): void {
  const mats = new Set<THREE.Material>();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
    }
  });
  mats.forEach((m) => {
    for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
    m.dispose();
  });
}
