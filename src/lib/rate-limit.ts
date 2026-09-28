import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { NextResponse } from "next/server";

import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "./config";
import { tooManyRequests, type ErrorBody } from "./response";

type LimitResult = {
  success: boolean;
  /** Unix timestamp in milliseconds when the caller's window resets. */
  reset: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

/**
 * Fixed-window counter store for the in-memory fallback. In-process only, so it
 * is per-instance: on serverless each instance counts separately, which is why
 * production uses Upstash instead.
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

/** Test-only helper so the in-memory limiter can be exercised without waiting a minute. */
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

function limitInMemory(ip: string): LimitResult {
  const now = Date.now();

  sweepExpired(now);

  let bucket = buckets.get(ip);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    buckets.set(ip, bucket);
  }

  bucket.count += 1;

  return { success: bucket.count <= RATE_LIMIT_MAX, reset: bucket.resetAt };
}

/**
 * Sliding-window limiter shared across all serverless instances through Upstash
 * Redis. Only created when UPSTASH_REDIS_REST_URL is set, so local development
 * works without Upstash by falling back to the in-memory limiter.
 */
function createUpstashLimiter(): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  if (!url) {
    return null;
  }

  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!token) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL is set but UPSTASH_REDIS_REST_TOKEN is not. Set both, or neither to use the in-memory limiter.",
    );
  }

  return new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(RATE_LIMIT_MAX, `${RATE_LIMIT_WINDOW_MS} ms`),
    prefix: "food-api:ratelimit",
  });
}

const upstashLimiter = createUpstashLimiter();

async function limit(ip: string): Promise<LimitResult> {
  if (!upstashLimiter) {
    return limitInMemory(ip);
  }

  try {
    const { success, reset } = await upstashLimiter.limit(ip);
    return { success, reset };
  } catch (cause) {
    // Fail open: an Upstash outage should not take the whole API down with it.
    console.error("[rate-limit] Upstash request failed; allowing request", cause);
    return { success: true, reset: Date.now() };
  }
}

/**
 * Counts this request against the caller's window. Resolves to a 429 response
 * when the limit is already exhausted, otherwise `null` so the route can
 * continue. Await this before any database work.
 */
export async function enforceRateLimit(
  request: Request,
): Promise<NextResponse<ErrorBody> | null> {
  const { success, reset } = await limit(getClientIp(request));

  if (success) {
    return null;
  }

  const retryAfterSeconds = (reset - Date.now()) / 1_000;

  return tooManyRequests(
    `Rate limit of ${RATE_LIMIT_MAX} requests per ${Math.round(
      RATE_LIMIT_WINDOW_MS / 1_000,
    )}s exceeded. Retry after ${Math.ceil(retryAfterSeconds)}s.`,
    retryAfterSeconds,
  );
}
