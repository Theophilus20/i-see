/**
 * Photos are prepared on the device before anything else happens:
 *  - decoded with the camera's orientation applied,
 *  - scaled so the long edge is at most 2048 px,
 *  - re-encoded as JPEG, which drops EXIF, including GPS location,
 *  - measured for blur, darkness and glare.
 */
import type { ImageUpload } from '@shared/api';
import { assessPixels, measurePixels, type PixelMetrics } from '@shared/quality';
import type { QualityReport } from '@shared/schema';

export interface PreparedImage {
  upload: ImageUpload;
  /** Object URL of the re-encoded image, for display. */
  url: string;
  blob: Blob;
  metrics: PixelMetrics;
  quality: QualityReport;
}

const MAX_EDGE = 2048;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/avif'];

export function acceptable(file: File): string | null {
  if (file.type && !ACCEPTED.includes(file.type)) return 'That file is not a photo I can read. Use a JPEG, PNG or WebP image.';
  if (file.size > 40 * 1024 * 1024) return 'That photo is larger than 40 MB.';
  return null;
}

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]+,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function measureSource(src: CanvasImageSource, w: number, h: number): PixelMetrics {
  const scale = Math.min(1, 512 / Math.max(w, h));
  const cw = Math.max(16, Math.round(w * scale));
  const ch = Math.max(16, Math.round(h * scale));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, cw, ch);
  return measurePixels(ctx.getImageData(0, 0, cw, ch).data, cw, ch);
}

export async function prepareImage(input: Blob, label: string | null = null): Promise<PreparedImage> {
  const bmp = await decode(input);
  const w0 = 'naturalWidth' in bmp ? bmp.naturalWidth : bmp.width;
  const h0 = 'naturalHeight' in bmp ? bmp.naturalHeight : bmp.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0));
  const w = Math.max(16, Math.round(w0 * scale));
  const h = Math.max(16, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  // Browsers shrink images with low-quality smoothing by default, which makes them soft and jagged.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  if ('close' in bmp) bmp.close();
  const blob: Blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.93));
  const metrics = measureSource(canvas, w, h);
  const base64 = await blobToBase64(blob);
  return {
    upload: { mime: 'image/jpeg', base64, width: w, height: h, label },
    url: URL.createObjectURL(blob),
    blob,
    metrics,
    quality: assessPixels(metrics, w, h),
  };
}

/** Crop a region of an image (for a close-up beside an answer). */
export async function cropToDataUrl(url: string, box: { x: number; y: number; w: number; h: number }, pad = 0.12): Promise<string> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const px = box.w * pad;
  const py = box.h * pad;
  const x = Math.max(0, box.x - px);
  const y = Math.max(0, box.y - py);
  const w = Math.min(img.naturalWidth - x, box.w + 2 * px);
  const h = Math.min(img.naturalHeight - y, box.h + 2 * py);
  const c = document.createElement('canvas');
  const s = Math.min(1, 640 / Math.max(w, h));
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d')!.drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}

export async function urlToBlob(url: string): Promise<Blob> {
  const r = await fetch(url);
  return r.blob();
}
