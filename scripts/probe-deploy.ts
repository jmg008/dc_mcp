import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchDocument, SearchDocument } from "../src/types/mcp.js";

const TARGET_GALLERY_ID = "thesingularity";
const probeOrigin = process.env.MCP_ALLOWED_ORIGIN?.trim() || "https://chat.openai.com";
const probeHours = parsePositiveInt(process.env.MCP_PROBE_HOURS, 24);
const explicitFetchId = process.env.MCP_FETCH_ID?.trim() || null;
const maxAttempts = parsePositiveInt(process.env.MCP_PROBE_ATTEMPTS, 3);
const retryDelayMs = parsePositiveInt(process.env.MCP_PROBE_RETRY_DELAY_MS, 2_000);

const mcpUrl = normalizeMcpUrl(process.argv[2] ?? process.env.MCP_URL ?? "");
const healthUrl = new URL("/healthz", mcpUrl);

await runWithRetries("healthz", () => verifyHealthz(healthUrl));
await runWithRetries("disallowed-origin", () => verifyDisallowedOrigin(mcpUrl));
await runWithRetries("invalid-session", () => verifyInvalidSession(mcpUrl));
await runWithRetries("mcp-round-trip", () => verifyMcpRoundTrip(mcpUrl));

async function verifyHealthz(url: URL): Promise<void> {
  const response = await fetch(url);
  assert(response.status === 200, `Expected ${url} to return 200, got ${response.status}.`);

  const payload = (await response.json()) as Record<string, unknown>;
  assert(payload.ok === true, "Health check payload must include ok=true.");
  assert(payload.galleryId === TARGET_GALLERY_ID, "Health check galleryId did not match.");
  assert(payload.endpoint === "/mcp", "Health check endpoint must be /mcp.");
}

async function verifyDisallowedOrigin(url: URL): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Origin: "https://evil.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });

  assert(response.status === 403, `Expected disallowed origin to return 403, got ${response.status}.`);
}

async function verifyInvalidSession(url: URL): Promise<void> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Origin: probeOrigin,
      "Mcp-Session-Id": "does-not-exist",
    },
  });

  assert(
    response.status === 400 || response.status === 405,
    `Expected invalid session id to return 400 (stateful) or 405 (stateless), got ${response.status}.`,
  );
}

async function verifyMcpRoundTrip(url: URL): Promise<void> {
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: {
        Origin: probeOrigin,
      },
    },
  });
  const client = new McpClient({
    name: "deployment-probe",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);

    const toolsResponse = await client.listTools();
    const toolNames = toolsResponse.tools.map((tool) => tool.name).sort();
    assert(toolNames.length === 2, `Expected exactly 2 tools, got ${toolNames.length}.`);
    assert(toolNames[0] === "fetch" && toolNames[1] === "search", "Expected only search/fetch tools.");

    const recent = await client.callTool({
      name: "search",
      arguments: { hours: probeHours },
    });
    assert(!recent.isError, "Recommended-post search returned an error.");

    const recentStructured = recent.structuredContent as
      | { results?: SearchDocument[]; galleryId?: string; hours?: number; mode?: string }
      | undefined;
    const recentResults = recentStructured?.results ?? [];
    assert(recentStructured?.galleryId === TARGET_GALLERY_ID, "Recommended search galleryId mismatch.");
    assert(recentStructured?.mode === "recommend", "Search mode must be recommend.");
    assert(recentStructured?.hours === probeHours, `Search hours must equal ${probeHours}.`);
    assert(recentResults.length > 0, "Recommended search returned no results.");
    assert(
      recentResults.every((item) => item.galleryId === TARGET_GALLERY_ID && item.id.startsWith(`${TARGET_GALLERY_ID}:`)),
      "Recommended search returned a post outside thesingularity.",
    );

    const fetchId = explicitFetchId ?? recentResults[0]?.id ?? null;
    assert(fetchId !== null, "No post id was available for fetch verification.");

    const fetched = await client.callTool({
      name: "fetch",
      arguments: { id: fetchId },
    });
    assert(!fetched.isError, `fetch(${JSON.stringify(fetchId)}) returned an error.`);

    const document = fetched.structuredContent as FetchDocument | undefined;
    assert(document !== undefined, "Fetch returned no structured content.");
    assert(document.id === fetchId, `Fetch returned ${document.id}, expected ${fetchId}.`);
    assert(typeof document.title === "string" && document.title.trim().length > 0, "Fetch title was empty.");
    assert(typeof document.text === "string", "Fetch text must be a string.");
    assert(typeof document.url === "string" && document.url.startsWith("http"), "Fetch url must be an http URL.");
    assert(document.metadata.galleryId === TARGET_GALLERY_ID, "Fetch galleryId mismatch.");
    assert(Array.isArray(document.comments), "Fetch comments must be an array.");
    assert(Array.isArray(document.imageUrls), "Fetch imageUrls must be an array.");

    process.stdout.write(
      JSON.stringify(
        {
          mcpUrl: url.toString(),
          healthUrl: healthUrl.toString(),
          allowedOrigin: probeOrigin,
          hours: probeHours,
          recentCount: recentResults.length,
          fetched: {
            id: document.id,
            title: document.title,
            url: document.url,
            commentCount: document.metadata.commentCount,
            imageCount: document.metadata.imageCount,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await transport.terminateSession().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
}

function normalizeMcpUrl(rawValue: string): URL {
  const trimmed = rawValue.trim();
  assert(trimmed.length > 0, "Provide an MCP URL via `npm run probe:deploy -- https://<service>.onrender.com/mcp` or MCP_URL.");

  const url = new URL(trimmed);
  if (url.pathname === "/" || url.pathname.length === 0) {
    url.pathname = "/mcp";
  }

  return url;
}

async function runWithRetries(name: string, work: () => Promise<void>): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await work();
      return;
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts || !isRetryableProbeError(error)) {
        throw enrichError(name, attempt, error);
      }

      process.stderr.write(
        `[probe] ${name} attempt ${attempt}/${maxAttempts} failed: ${toErrorMessage(error)}; retrying in ${retryDelayMs}ms\n`,
      );
      await delay(retryDelayMs);
    }
  }

  throw enrichError(name, maxAttempts, lastError);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRetryableProbeError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  const maybeStatus = (error as { code?: number } | null)?.code;

  if (typeof maybeStatus === "number" && [404, 408, 429, 500, 502, 503, 504].includes(maybeStatus)) {
    return true;
  }

  return /timed out|timeout|network|socket|econn|reset|not found|temporarily unavailable|got 404|got 408|got 429|got 500|got 502|got 503|got 504/.test(
    message,
  );
}

function enrichError(name: string, attempt: number, error: unknown): Error {
  const base = error instanceof Error ? error : new Error(String(error));
  return new Error(`[probe:${name}] failed after ${attempt} attempt(s): ${base.message}`);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
