/**
 * Upload checks. Images: real magic bytes, size caps, and a re-encode with sharp that
 * applies EXIF orientation and drops all metadata (including GPS). Audio: a strict WAV
 * header check against what Muse Voice Transcribe accepts.
 */
import sharp from 'sharp';
import type { ImageUpload } from '../src/shared/api';

export class UploadError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function sniff(buf: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.length >= 12 && String.fromCharCode(...buf.slice(0, 4)) === 'RIFF' && String.fromCharCode(...buf.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export function decodeImage(upload: Pick<ImageUpload, 'base64' | 'mime'>, maxBytes: number): Buffer {
  const b64 = upload.base64.replace(/\s+/g, '');
  if (!B64.test(b64)) throw new UploadError('The image is not valid base64.', 'bad_image');
  if ((b64.length * 3) / 4 > maxBytes * 1.01) throw new UploadError(`The image is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`, 'image_too_large', 413);
  const buf = Buffer.from(b64, 'base64');
  const kind = sniff(buf);
  if (!kind) throw new UploadError('That file is not a JPEG, PNG or WebP image.', 'bad_image_type', 415);
  if (kind !== upload.mime) throw new UploadError(`The image says it is ${upload.mime} but its bytes are ${kind}.`, 'mime_mismatch', 415);
  return buf;
}

/** Re-encodes to JPEG at most 2048 px, orientation applied, metadata removed. */
export async function sanitizeImage(upload: ImageUpload, maxBytes: number): Promise<ImageUpload> {
  const buf = decodeImage(upload, maxBytes);
  try {
    const { data, info } = await sharp(buf, { limitInputPixels: 50_000_000, failOn: 'error' })
      .rotate()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { mime: 'image/jpeg', base64: data.toString('base64'), width: info.width, height: info.height, label: upload.label };
  } catch {
    throw new UploadError('The image could not be read.', 'bad_image');
  }
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationMs: number;
}

/** Mono 16-bit PCM at 16 or 24 kHz, which is what the transcription endpoint documents. */
export function inspectWav(buf: Uint8Array, maxSeconds = 600): WavInfo {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const str = (o: number, n: number) => String.fromCharCode(...buf.slice(o, o + n));
  if (buf.length < 44 || str(0, 4) !== 'RIFF' || str(8, 4) !== 'WAVE') throw new UploadError('The audio must be a WAV file.', 'bad_audio', 415);
  let off = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let dataBytes = -1;
  while (off + 8 <= buf.length) {
    const id = str(off, 4);
    const size = dv.getUint32(off + 4, true);
    if (id === 'fmt ' && off + 24 <= buf.length) {
      fmt = { format: dv.getUint16(off + 8, true), channels: dv.getUint16(off + 10, true), rate: dv.getUint32(off + 12, true), bits: dv.getUint16(off + 22, true) };
    } else if (id === 'data') {
      dataBytes = Math.min(size, buf.length - off - 8);
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt || dataBytes < 0) throw new UploadError('The WAV file is incomplete.', 'bad_audio');
  if (fmt.format !== 1 || fmt.bits !== 16) throw new UploadError('The audio must be 16-bit PCM.', 'bad_audio', 415);
  if (fmt.channels !== 1) throw new UploadError('The audio must be mono.', 'bad_audio', 415);
  if (fmt.rate !== 16000 && fmt.rate !== 24000) throw new UploadError('The audio must be sampled at 16 or 24 kHz.', 'bad_audio', 415);
  const durationMs = Math.round((dataBytes / (fmt.rate * 2)) * 1000);
  if (durationMs > maxSeconds * 1000) throw new UploadError(`Recordings can be at most ${Math.round(maxSeconds / 60)} minutes.`, 'audio_too_long', 413);
  return { sampleRate: fmt.rate, channels: 1, bitsPerSample: 16, durationMs };
}
