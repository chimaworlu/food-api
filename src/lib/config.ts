function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[config] ${name}="${raw}" is not a positive integer; falling back to ${fallback}.`,
    );
    return fallback;
  }

  return parsed;
}

export const RATE_LIMIT_MAX = readPositiveInt("RATE_LIMIT_MAX", 100);
export const RATE_LIMIT_WINDOW_MS = readPositiveInt("RATE_LIMIT_WINDOW_MS", 60_000);
export const DEFAULT_PAGE_LIMIT = readPositiveInt("DEFAULT_PAGE_LIMIT", 20);
export const MAX_PAGE_LIMIT = readPositiveInt("MAX_PAGE_LIMIT", 100);

/**
 * Prisma's own defaults are maxWait 2s and timeout 5s. The database is remote,
 * so a round trip can exceed 2s and any multi-query transaction can exceed 5s,
 * which surfaces as P2028 / P2028 expired transaction.
 */
export const DB_POOL_MAX = readPositiveInt("DB_POOL_MAX", 10);
export const DB_TRANSACTION_MAX_WAIT_MS = readPositiveInt(
  "DB_TRANSACTION_MAX_WAIT_MS",
  30_000,
);
export const DB_TRANSACTION_TIMEOUT_MS = readPositiveInt(
  "DB_TRANSACTION_TIMEOUT_MS",
  60_000,
);

/**
 * Observed TCP connect latency to this database is 2-10s and the load-balanced
 * host occasionally drops a handshake outright, which surfaces as "Can't reach
 * database server". pg's default connect timeout is far too short for that, so
 * the pool is given the same generous budget the seed script already uses.
 */
export const DB_CONNECTION_TIMEOUT_MS = readPositiveInt(
  "DB_CONNECTION_TIMEOUT_MS",
  45_000,
);
export const DB_IDLE_TIMEOUT_MS = readPositiveInt("DB_IDLE_TIMEOUT_MS", 30_000);
