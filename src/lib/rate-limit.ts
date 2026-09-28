import type { NextResponse } from "next/server";

import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "./config";
import { tooManyRequests, type ErrorBody } from "./response";

type Bucket = {
  count: number;
  resetAt: number;
};

/**
 * Fixed-window counter store. In-process only, so it is per-instance/per-pod:
 * that is the documented trade-off of the in-memory requirement.
 */
const buckets = new Map<string, Bucket>();

const SWEEP_THRESHOLD = 1_000;

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function sweepExpired(now: number): void {
  if (buckets.size < SWEEP_THRESHOLD) {
    return;
  }

  for (const [ip, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(ip);
    }
  }
}

/** Test-only helper so the limiter can be exercised without waiting a minute. */
export function resetRateLimits(): void {
  buckets.clear();
}

export function remainingRequests(ip: string): number {
  const bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= Date.now()) {
    return RATE_LIMIT_MAX;
  }
  return Math.max(0, RATE_LIMIT_MAX - bucket.count);
}

/**
 * Counts this request against the caller's window. Returns a 429 response when
 * the limit is already exhausted, otherwise `null` so the route can continue.
 * Call this before any database work.
 */
export function enforceRateLimit(request: Request): NextResponse<ErrorBody> | null {
  const ip = getClientIp(request);
  const now = Date.now();

  sweepExpired(now);

  let bucket = buckets.get(ip);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    buckets.set(ip, bucket);
  }

  bucket.count += 1;

  if (bucket.count <= RATE_LIMIT_MAX) {
    return null;
  }

  const retryAfterSeconds = (bucket.resetAt - now) / 1_000;

  return tooManyRequests(
    `Rate limit of ${RATE_LIMIT_MAX} requests per ${Math.round(
      RATE_LIMIT_WINDOW_MS / 1_000,
    )}s exceeded. Retry after ${Math.ceil(retryAfterSeconds)}s.`,
    retryAfterSeconds,
  );
}
