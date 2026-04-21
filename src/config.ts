import { createApp } from "./http/app.js";

export function createConfiguredApp() {
  const isProduction = process.env.NODE_ENV === "production";
  const isVercel = process.env.VERCEL === "1";
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return createApp({
    allowedOrigins,
    requestTimeoutMs: parseNumber(process.env.REQUEST_TIMEOUT_MS, 15_000),
    recentCacheTtlMs: parseNumber(process.env.RECENT_CACHE_TTL_MS, 45_000),
    postCacheTtlMs: parseNumber(process.env.POST_CACHE_TTL_MS, 180_000),
    maxConcurrency: parseNumber(process.env.MAX_CONCURRENCY, 2),
    statelessMcp: isVercel || process.env.MCP_STATELESS === "1",
    requireAllowedOrigins: isProduction,
  });
}

export function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}
