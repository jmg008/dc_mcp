import dotenv from "dotenv";
import { createApp } from "./http/app.js";

dotenv.config();

const port = parseNumber(process.env.PORT, 3000);
const host = process.env.HOST?.trim() || "0.0.0.0";
const isProduction = process.env.NODE_ENV === "production";
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const app = createApp({
  allowedOrigins,
  requestTimeoutMs: parseNumber(process.env.REQUEST_TIMEOUT_MS, 15_000),
  recentCacheTtlMs: parseNumber(process.env.RECENT_CACHE_TTL_MS, 45_000),
  postCacheTtlMs: parseNumber(process.env.POST_CACHE_TTL_MS, 180_000),
  maxConcurrency: parseNumber(process.env.MAX_CONCURRENCY, 2),
  requireAllowedOrigins: isProduction,
});

app.listen(port, host, () => {
  process.stderr.write(
    `[dcinside-mcp] listening on http://${host}:${port}/mcp (gallery: thesingularity)\n`,
  );
});

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}
