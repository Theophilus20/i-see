/**
 * The Passport: profiles saved on this device only (IndexedDB).
 * The server never stores scans. Export and delete-everything are one click each.
 */
import { openDB, type IDBPDatabase } from 'idb';
import { z } from 'zod';
import { ProfileSchema, type Finding, type Profile } from '@shared/schema';

export interface PassportEntry {
  id: string;
  profile: Profile;
  /** Re-encoded photos, in view order. */
  images: Blob[];
  /** The generated cutaway drawing, kept so it is not drawn twice. */
  illustration?: Blob | null;
  /** The cutaway drawn from the photo, with each part outlined and labelled on it. */
  cutaway?: {
    /** The labelled drawing. */
    image: Blob;
    width: number;
    height: number;
    /** The drawing without labels, sized like the photo. */
    clean?: Blob | null;
    regions: import('@shared/schema').Region[];
    review: import('@shared/api').CutawayResponse['review'];
    labels?: import('@shared/api').CutawayResponse['labels'];
    createdAt: string;
    /** 'inside-only': drawn without skin or casing. Older drawings have no style. */
    style?: 'inside-only';
  } | null;
  /** Saved by older versions (the workshop, since removed). Ignored. */
  workshop?: unknown;
  savedAt: string;
  sample: boolean;
}

const DB = 'isee';
const STORE = 'passport';
let dbp: Promise<IDBPDatabase> | null = null;
let memory: Map<string, PassportEntry> | null = null; // fallback when IndexedDB is unavailable

function db(): Promise<IDBPDatabase> | null {
  if (memory) return null;
  if (!dbp) {
    try {
      dbp = openDB(DB, 1, {
        upgrade(d) {
          d.createObjectStore(STORE, { keyPath: 'id' });
        },
      });
      dbp.catch(() => {
        memory = new Map();
        dbp = null;
      });
    } catch {
      memory = new Map();
      return null;
    }
  }
  return dbp;
}

export async function listEntries(): Promise<PassportEntry[]> {
  const d = db();
  let all: PassportEntry[];
  try {
    all = d ? ((await (await d).getAll(STORE)) as PassportEntry[]) : [...(memory ?? new Map()).values()];
  } catch {
    memory ??= new Map();
    all = [...memory.values()];
  }
  return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function getEntry(id: string): Promise<PassportEntry | null> {
  const d = db();
  try {
    if (d) return ((await (await d).get(STORE, id)) as PassportEntry | undefined) ?? null;
  } catch {
    /* fall through */
  }
  return memory?.get(id) ?? null;
}

export async function putEntry(e: PassportEntry): Promise<void> {
  const d = db();
  try {
    if (d) {
      await (await d).put(STORE, e);
      return;
    }
  } catch {
    memory ??= new Map();
  }
  memory!.set(e.id, e);
}

export async function deleteEntry(id: string): Promise<void> {
  const d = db();
  try {
    if (d) await (await d).delete(STORE, id);
  } catch {
    /* ignore */
  }
  memory?.delete(id);
}

export async function deleteAll(): Promise<void> {
  const d = db();
  try {
    if (d) await (await d).clear(STORE);
  } catch {
    /* ignore */
  }
  memory?.clear();
}

/** Adds or replaces the person's own note on a profile. Notes are marked "Yours" and never graded. */
export function withNote(p: Profile, text: string, now: string): Profile {
  const id = `n${Date.now().toString(36)}`;
  const note: Finding = {
    id,
    section: 'uses',
    text: text.slice(0, 700),
    basis: 'user',
    confidence: null,
    regionIds: [],
    sourceIds: [],
    quote: null,
    verification: { status: 'not_applicable', notes: ['Added by you. Not checked.'] },
    recheckAfter: null,
    flags: [],
    origin: 'user',
    disputed: false,
    note: null,
  };
  return { ...p, findings: [...p.findings, note].slice(-120), updatedAt: now };
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

const ExportSchema = z.object({
  format: z.literal('i-see-passport'),
  version: z.literal(1),
  exportedAt: z.string(),
  entries: z.array(
    z.object({
      id: z.string(),
      savedAt: z.string(),
      sample: z.boolean(),
      profile: ProfileSchema,
      images: z.array(z.object({ mime: z.string(), base64: z.string() })),
    }),
  ),
});

const toB64 = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).replace(/^data:[^,]+,/, ''));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

export async function exportPassport(entries?: PassportEntry[]): Promise<Blob> {
  const list = entries ?? (await listEntries());
  const out = {
    format: 'i-see-passport' as const,
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    entries: await Promise.all(
      list.map(async (e) => ({ id: e.id, savedAt: e.savedAt, sample: e.sample, profile: e.profile, images: await Promise.all(e.images.map(async (b) => ({ mime: b.type || 'image/jpeg', base64: await toB64(b) }))) })),
    ),
  };
  return new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
}

export async function importPassport(file: File): Promise<{ added: number; skipped: number }> {
  const text = await file.text();
  const parsed = ExportSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error('This is not an I SEE passport export, or it is damaged.');
  let added = 0;
  let skipped = 0;
  for (const e of parsed.data.entries) {
    if (!/^image\/(jpeg|png|webp)$/.test(e.images[0]?.mime ?? '')) {
      skipped++;
      continue;
    }
    const images = e.images.map((i) => {
      const bin = atob(i.base64);
      const arr = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
      return new Blob([arr], { type: i.mime });
    });
    await putEntry({ id: e.id, savedAt: e.savedAt, sample: e.sample, profile: e.profile, images });
    added++;
  }
  return { added, skipped };
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
