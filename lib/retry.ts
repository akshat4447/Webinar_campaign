// Pure retry helpers shared by the LeadSquared and Zoom API clients.

/** "Full jitter" backoff: a uniform random delay in [0, min(cap, base * 2^attempt)). */
export function fullJitterDelayMs(attempt: number, opts: { baseMs?: number; capMs?: number; rand?: () => number } = {}): number {
  const { baseMs = 500, capMs = 15_000, rand = Math.random } = opts;
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(rand() * ceiling);
}

/**
 * Parses a `Retry-After` header (delta-seconds or an HTTP date) to milliseconds.
 * Returns null when absent or unparseable. Clamped to [0, capMs] so a hostile or
 * buggy upstream cannot park a worker for hours.
 */
export function parseRetryAfterMs(header: string | null | undefined, nowMs: number = Date.now(), capMs = 30_000): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  let ms: number;
  if (/^\d+(\.\d+)?$/.test(trimmed)) ms = Number(trimmed) * 1000;
  else {
    const at = Date.parse(trimmed);
    if (!Number.isFinite(at)) return null;
    ms = at - nowMs;
  }
  return Math.min(Math.max(ms, 0), capMs);
}

/** How long to wait before retry `attempt` (0-based): the server's hint if given, else full-jitter backoff. */
export function retryDelayMs(attempt: number, retryAfterHeader?: string | null, opts: { baseMs?: number; capMs?: number; rand?: () => number } = {}): number {
  return parseRetryAfterMs(retryAfterHeader) ?? fullJitterDelayMs(attempt, opts);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
