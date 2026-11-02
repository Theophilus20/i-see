/**
 * Logging with redaction. Nothing that could identify a person or unlock an account
 * reaches a log line: API keys, bearer tokens, base64 image or audio data, and data URLs
 * are replaced before anything is written.
 */
const KEY_PATTERNS: RegExp[] = [
  /LLM\|[^|\s"']+\|[^\s"']+/g, // Meta Model API key format
  /Bearer\s+[A-Za-z0-9._|\-~+/=]+/gi,
  /(api[_-]?key|authorization|token|secret)(["'\s:=]+)([^"'\s,}]+)/gi,
  /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi,
  /[A-Za-z0-9+/]{200,}={0,2}/g, // long base64 runs
];

export function redact(input: unknown): string {
  let s: string;
  try {
    s = typeof input === 'string' ? input : JSON.stringify(input);
  } catch {
    s = String(input);
  }
  s = s.replace(KEY_PATTERNS[0]!, '[redacted-key]');
  s = s.replace(KEY_PATTERNS[1]!, 'Bearer [redacted]');
  s = s.replace(KEY_PATTERNS[2]!, (_m, k: string, sep: string) => `${k}${sep}[redacted]`);
  s = s.replace(KEY_PATTERNS[3]!, '[redacted-data-url]');
  s = s.replace(KEY_PATTERNS[4]!, '[redacted-base64]');
  return s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
}

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold: Level = (process.env.LOG_LEVEL as Level) in ORDER ? (process.env.LOG_LEVEL as Level) : 'info';
let sink: (line: string) => void = (line) => process.stderr.write(`${line}\n`);

export function setLogSink(fn: (line: string) => void, level: Level = threshold): void {
  sink = fn;
  threshold = level;
}

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < ORDER[threshold]) return;
  sink(redact({ t: new Date().toISOString(), level, msg, ...fields }));
}
