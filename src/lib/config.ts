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
