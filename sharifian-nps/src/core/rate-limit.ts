// In-memory sliding-window limiter (single process is enough for ~500 customers).

export interface LimitResult {
  ok: boolean;
  retryAfterSec: number;
}

export class RateLimiter {
  readonly limit: number;
  readonly windowMs: number;
  private readonly hits = new Map<string, number[]>();
  private calls = 0;

  /** limit <= 0 disables the limiter. */
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  hit(key: string, now: number): LimitResult {
    if (this.limit <= 0) return { ok: true, retryAfterSec: 0 };
    if (++this.calls % 1000 === 0) this.prune(now);

    const since = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      const oldest = recent[0] ?? now;
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { ok: true, retryAfterSec: 0 };
  }

  reset(key?: string): void {
    if (key === undefined) this.hits.clear();
    else this.hits.delete(key);
  }

  private prune(now: number): void {
    const since = now - this.windowMs;
    for (const [key, list] of this.hits) {
      if ((list[list.length - 1] ?? 0) <= since) this.hits.delete(key);
    }
  }
}
