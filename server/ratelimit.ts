/** Token bucket per client key. In memory: one process, no persistence. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private readonly perMinute: number,
    private readonly burst = Math.max(1, Math.ceil(perMinute / 3)),
    private readonly clock: () => number = Date.now,
  ) {}

  /** Returns 0 if allowed, else milliseconds to wait. */
  take(key: string, cost = 1): number {
    const now = this.clock();
    const rate = this.perMinute / 60_000;
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + (now - b.at) * rate);
    b.at = now;
    if (b.tokens >= cost) {
      b.tokens -= cost;
      this.buckets.set(key, b);
      if (this.buckets.size > 10_000) this.sweep(now);
      return 0;
    }
    this.buckets.set(key, b);
    return Math.ceil((cost - b.tokens) / rate);
  }

  private sweep(now: number): void {
    for (const [k, b] of this.buckets) if (now - b.at > 10 * 60_000) this.buckets.delete(k);
  }
}
