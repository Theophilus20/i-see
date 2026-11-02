/**
 * Photo quality, measured on the device before anything is sent.
 *
 * Runs on raw RGBA pixels (a canvas ImageData in the browser, a decoded buffer on
 * the server), so the camera screen can say "hold still" before a model is asked
 * to squint at a blurred photo. The vision model's own judgement is merged in later.
 */
import type { QualityReport } from './schema';

export interface PixelMetrics {
  /** Variance of the Laplacian on a grey image of about 512 px. Below ~60 is usually blurred. */
  sharpness: number;
  /** Mean luminance, 0 (black) to 1 (white). */
  brightness: number;
  /** Share of pixels that are blown out or crushed, 0 to 1. */
  clipped: number;
}

export function measurePixels(rgba: ArrayLike<number>, width: number, height: number): PixelMetrics {
  const n = width * height;
  if (n === 0 || rgba.length < n * 4) return { sharpness: 0, brightness: 0, clipped: 1 };
  const grey = new Float32Array(n);
  let sum = 0;
  let clipped = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const y = (0.2126 * rgba[p]! + 0.7152 * rgba[p + 1]! + 0.0722 * rgba[p + 2]!) / 255;
    grey[i] = y;
    sum += y;
    if (y > 0.98 || y < 0.02) clipped++;
  }
  let lapSum = 0;
  let lapSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = (grey[i - 1]! + grey[i + 1]! + grey[i - width]! + grey[i + width]! - 4 * grey[i]!) * 255;
      lapSum += lap;
      lapSq += lap * lap;
      count++;
    }
  }
  const mean = count ? lapSum / count : 0;
  const variance = count ? lapSq / count - mean * mean : 0;
  return { sharpness: Math.round(variance * 10) / 10, brightness: sum / n, clipped: clipped / n };
}

export const QUALITY_THRESHOLDS = { blurry: 60, dark: 0.18, bright: 0.86, clipped: 0.22, minSide: 320, lowRes: 900 } as const;

/** Plain-language report from on-device numbers. `adequate` is false only for problems that wreck identification. */
export function assessPixels(m: PixelMetrics, width: number, height: number): QualityReport {
  const issues: QualityReport['issues'] = [];
  const advice: string[] = [];
  if (m.sharpness < QUALITY_THRESHOLDS.blurry) {
    issues.push({ kind: 'blur', note: 'The photo looks blurred.' });
    advice.push('Hold the phone still, or rest it on something, and tap to focus on the object.');
  }
  if (m.brightness < QUALITY_THRESHOLDS.dark) {
    issues.push({ kind: 'dark', note: 'The photo is dark.' });
    advice.push('Move towards a window or switch on a light. Avoid the flash on shiny things.');
  }
  if (m.brightness > QUALITY_THRESHOLDS.bright || m.clipped > QUALITY_THRESHOLDS.clipped) {
    issues.push({ kind: 'glare', note: 'Parts of the photo are washed out.' });
    advice.push('Tilt the object or step to one side so reflections do not hit the lens.');
  }
  if (Math.min(width, height) < QUALITY_THRESHOLDS.minSide) {
    issues.push({ kind: 'small', note: 'The image is small.' });
    advice.push('Move closer so the object fills most of the frame.');
  } else if (Math.min(width, height) < QUALITY_THRESHOLDS.lowRes) {
    issues.push({ kind: 'small', note: 'The photo is low resolution, so small parts may be missed.' });
    advice.push('Use the original photo from the camera, not a screenshot or a copy sent through a chat app, which are made smaller.');
  }
  const severe = m.sharpness < QUALITY_THRESHOLDS.blurry * 0.4 || m.brightness < 0.08;
  return {
    adequate: !severe,
    issues,
    advice,
    metrics: { sharpness: m.sharpness, brightness: Math.round(m.brightness * 1000) / 1000, clipped: Math.round(m.clipped * 1000) / 1000 },
  };
}

/** Merge the device's measurement with the vision model's judgement. Either can mark the photo inadequate. */
export function mergeQuality(device: QualityReport | null, model: Pick<QualityReport, 'adequate' | 'issues' | 'advice'> | null): QualityReport {
  const base: QualityReport = device ?? { adequate: true, issues: [], advice: [], metrics: null };
  if (!model) return base;
  const kinds = new Set(base.issues.map((i) => i.kind));
  const issues = [...base.issues, ...model.issues.filter((i) => !kinds.has(i.kind))].slice(0, 8);
  const advice = [...new Set([...base.advice, ...model.advice])].slice(0, 6);
  return { adequate: base.adequate && model.adequate, issues, advice, metrics: base.metrics };
}
