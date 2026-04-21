import { randomUUID } from "node:crypto";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { DcClient } from "../dc/client.js";
import { createDcClient } from "../dc/client.js";
import { createMcpServer } from "../mcp/server.js";
import { TARGET_GALLERY_ID } from "../types/dc.js";
import { runWithRequestContext } from "./requestContext.js";

export interface AppOptions {
  allowedOrigins: string[];
  requestTimeoutMs: number;
  recentCacheTtlMs: number;
  postCacheTtlMs: number;
  maxConcurrency: number;
  statelessMcp?: boolean;
  requireAllowedOrigins?: boolean;
  dcClient?: DcClient;
  logger?: (event: string, data?: Record<string, unknown>) => void;
}

type Session = {
  transport: StreamableHTTPServerTransport;
};

type RequestWithId = Request & {
  requestId?: string;
};

export function createApp(options: AppOptions) {
  const app = express();
  const statelessMcp = options.statelessMcp ?? false;
  const allowedOrigins = new Set(
    options.allowedOrigins.map((origin) => origin.trim()).filter((origin) => origin.length > 0),
  );
  if (options.requireAllowedOrigins && allowedOrigins.size === 0) {
    throw new Error("ALLOWED_ORIGINS must be set when running in production.");
  }

  const sessions = new Map<string, Session>();
  const log = options.logger ?? createLogger();
  const dcClient =
    options.dcClient ??
    createDcClient({
      requestTimeoutMs: options.requestTimeoutMs,
      recentCacheTtlMs: options.recentCacheTtlMs,
      postCacheTtlMs: options.postCacheTtlMs,
      maxConcurrency: options.maxConcurrency,
      logger: log,
    });

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.use((req: RequestWithId, _res: Response, next: NextFunction) => {
    req.requestId = req.header("x-request-id") ?? randomUUID();
    next();
  });

  app.use("/mcp", (req: Request, res: Response, next: NextFunction) => {
    if (allowedOrigins.size === 0) {
      return next();
    }

    const origin = req.header("origin")?.trim();
    if (!origin) {
      return next();
    }

    if (!allowedOrigins.has(origin)) {
      return res.status(403).json({ error: "Origin is not allowed." });
    }

    return next();
  });

  const handleMcpRequest = async (req: RequestWithId, res: Response) => {
    const startedAt = Date.now();
    const requestId = req.requestId ?? randomUUID();
    const postNo = extractPostNoFromBody(req.body);

    try {
      if (statelessMcp) {
        await runStatelessMcpRequest({
          req,
          res,
          log,
          dcClient,
          requestId,
          postNo,
          requestTimeoutMs: options.requestTimeoutMs,
        });

        log("request.success", {
          requestId,
          method: req.method,
          path: req.path,
          origin: req.header("origin") ?? null,
          sessionId: null,
          galleryId: TARGET_GALLERY_ID,
          postNo,
          latencyMs: Date.now() - startedAt,
          transportMode: "stateless",
        });
        return;
      }

      const transport = await resolveTransport({
        req,
        res,
        sessions,
        log,
        dcClient,
      });

      if (!transport) {
        return;
      }

      await runWithRequestContext(
        {
          requestId,
          galleryId: TARGET_GALLERY_ID,
          postNo,
        },
        () =>
          withTimeout(
            () => transport.handleRequest(req, res, req.body),
            options.requestTimeoutMs,
            `MCP request timed out after ${options.requestTimeoutMs}ms.`,
          ),
      );

      log("request.success", {
        requestId,
        method: req.method,
        path: req.path,
        origin: req.header("origin") ?? null,
        sessionId: transport.sessionId ?? null,
        galleryId: TARGET_GALLERY_ID,
        postNo,
        latencyMs: Date.now() - startedAt,
        transportMode: "stateful",
      });
    } catch (error) {
      log("request.error", {
        requestId,
        method: req.method,
        path: req.path,
        origin: req.header("origin") ?? null,
        galleryId: TARGET_GALLERY_ID,
        postNo,
        latencyMs: Date.now() - startedAt,
        transportMode: statelessMcp ? "stateless" : "stateful",
        error: error instanceof Error ? error.message : String(error),
      });

      if (!res.headersSent) {
        res.status(504).json({
          error: "Request failed or timed out.",
          requestId,
        });
      }
    }
  };

  app.post("/mcp", handleMcpRequest);
  app.get("/mcp", handleMcpRequest);
  app.delete("/mcp", handleMcpRequest);

  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({
      ok: true,
      galleryId: TARGET_GALLERY_ID,
      endpoint: "/mcp",
    });
  });

  return app;
}

async function runStatelessMcpRequest(args: {
  req: Request;
  res: Response;
  log: (event: string, data?: Record<string, unknown>) => void;
  dcClient: DcClient;
  requestId: string;
  postNo: string | null;
  requestTimeoutMs: number;
}): Promise<void> {
  const { req, res, log, dcClient, requestId, postNo, requestTimeoutMs } = args;

  if (req.method !== "POST") {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    });
    return;
  }

  const server = createMcpServer({
    dcClient,
    logger: log,
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  let closed = false;
  const closeResources = () => {
    if (closed) {
      return;
    }
    closed = true;
    void transport.close().catch(() => undefined);
    void server.close().catch(() => undefined);
  };

  res.once("close", closeResources);

  try {
    await server.connect(transport);
    await runWithRequestContext(
      {
        requestId,
        galleryId: TARGET_GALLERY_ID,
        postNo,
      },
      () =>
        withTimeout(
          () => transport.handleRequest(req, res, req.body),
          requestTimeoutMs,
          `MCP request timed out after ${requestTimeoutMs}ms.`,
        ),
    );
  } catch (error) {
    closeResources();
    throw error;
  }
}

function createLogger() {
  return (event: string, data: Record<string, unknown> = {}) => {
    const logline = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...data,
    });
    process.stderr.write(`${logline}\n`);
  };
}

async function resolveTransport(args: {
  req: Request;
  res: Response;
  sessions: Map<string, Session>;
  log: (event: string, data?: Record<string, unknown>) => void;
  dcClient: DcClient;
}): Promise<StreamableHTTPServerTransport | null> {
  const { req, res, sessions, log, dcClient } = args;
  const sessionId = req.header("mcp-session-id");

  if (sessionId) {
    const existing = sessions.get(sessionId);
    if (!existing) {
      res.status(400).json({ error: `Unknown MCP session id "${sessionId}".` });
      return null;
    }
    return existing.transport;
  }

  if (req.method !== "POST") {
    res.status(400).json({
      error: "Missing MCP session id. Start a session with POST /mcp first.",
    });
    return null;
  }

  const server = createMcpServer({
    dcClient,
    logger: log,
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (newSessionId: string) => {
      sessions.set(newSessionId, { transport });
      log("session.created", { sessionId: newSessionId });
    },
  });

  transport.onclose = () => {
    if (!transport.sessionId) {
      return;
    }
    sessions.delete(transport.sessionId);
    log("session.closed", { sessionId: transport.sessionId });
  };

  await server.connect(transport);
  return transport;
}

function extractPostNoFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const params = (body as Record<string, unknown>).params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }

  const args = (params as Record<string, unknown>).arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return null;
  }

  const id = (args as Record<string, unknown>).id;
  if (typeof id !== "string") {
    return null;
  }

  const match = id.match(/:(\d+)$/) ?? id.match(/^(\d+)$/);
  return match?.[1] ?? null;
}

async function withTimeout<T>(
  work: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    timeoutId.unref?.();
  });

  try {
    return await Promise.race([work(), timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
