/**
 * Records a spoken question and encodes it as the WAV Muse Voice Transcribe accepts:
 * mono, 16-bit PCM, 24 kHz. Capped at 60 seconds (the API allows ten minutes; a
 * question never needs that).
 */
export const SAMPLE_RATE = 24_000;
export const MAX_SECONDS = 60;

export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Blob {
  const bytes = 44 + samples.length * 2;
  const buf = new ArrayBuffer(bytes);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Linear resampling to the target rate. Good enough for speech. */
export function resample(input: Float32Array, from: number, to = SAMPLE_RATE): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const t = x - i0;
    out[i] = input[i0]! * (1 - t) + input[i1]! * t;
  }
  return out;
}

export interface Recorder {
  stop: () => Promise<Blob>;
  cancel: () => void;
  /** 0 to 1, for a level meter. */
  level: () => number;
}

export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  // ScriptProcessor is deprecated but universally available and fine for a short question.
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let total = 0;
  const limit = MAX_SECONDS * ctx.sampleRate;
  proc.onaudioprocess = (e) => {
    if (total >= limit) return;
    const data = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(data);
    total += data.length;
  };
  source.connect(analyser);
  source.connect(proc);
  proc.connect(ctx.destination);
  const levelBuf = new Uint8Array(analyser.frequencyBinCount);
  const close = () => {
    proc.disconnect();
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
  return {
    level: () => {
      analyser.getByteTimeDomainData(levelBuf);
      let peak = 0;
      for (const b of levelBuf) peak = Math.max(peak, Math.abs(b - 128) / 128);
      return peak;
    },
    cancel: close,
    stop: async () => {
      const rate = ctx.sampleRate;
      close();
      const joined = new Float32Array(total);
      let o = 0;
      for (const c of chunks) {
        joined.set(c, o);
        o += c.length;
      }
      return encodeWav(resample(joined, rate));
    },
  };
}
