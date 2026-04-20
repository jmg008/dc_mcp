import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/http/app.js";
import type { DcClient } from "../src/dc/client.js";
import { TARGET_GALLERY_ID } from "../src/types/dc.js";

function makeClient(): DcClient {
  return {
    listRecent: vi.fn(async () => [
      {
        id: `${TARGET_GALLERY_ID}:100`,
        postNo: "100",
        galleryId: TARGET_GALLERY_ID,
        title: "Latest post",
        url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=100",
        raw: {},
      },
    ]),
    searchGallery: vi.fn(async () => [
      {
        id: `${TARGET_GALLERY_ID}:101`,
        postNo: "101",
        galleryId: TARGET_GALLERY_ID,
        title: "Search result",
        url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=101",
        raw: {},
      },
    ]),
    getPost: vi.fn(async (postNo: string) => ({
      id: `${TARGET_GALLERY_ID}:${postNo}`,
      postNo,
      galleryId: TARGET_GALLERY_ID,
      title: "Fetched post",
      bodyText: "Body text",
      comments: [{ author: "user1", text: "comment one", depth: 0 }],
      imageUrls: ["https://example.com/image.jpg"],
      url: `https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=${postNo}`,
      author: "author1",
      createdAt: "2026-01-01",
      views: 11,
      upvotes: 7,
      commentCount: 1,
      raw: {},
    })),
  };
}

describe("http app", () => {
  let server: HttpServer | undefined;
  let baseUrl = "";

  beforeEach(async () => {
    const app = createApp({
      allowedOrigins: ["https://chat.openai.com"],
      requestTimeoutMs: 15_000,
      recentCacheTtlMs: 45_000,
      postCacheTtlMs: 180_000,
      maxConcurrency: 2,
      dcClient: makeClient(),
      logger: () => undefined,
    });

    server = await new Promise<HttpServer>((resolve) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
    server = undefined;
  });

  it("serves healthz", async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      galleryId: TARGET_GALLERY_ID,
      endpoint: "/mcp",
    });
  });

  it("round-trips search and fetch over streamable http", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: {
        headers: {
          Origin: "https://chat.openai.com",
        },
      },
    });
    const client = new McpClient({
      name: "test-client",
      version: "1.0.0",
    });

    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(["search", "fetch"]);

    const search = await client.callTool({
      name: "search",
      arguments: { query: "" },
    });
    expect(search.content[0]).toMatchObject({
      type: "text",
    });
    expect((search.content[0] as { text: string }).text).toContain(`${TARGET_GALLERY_ID}:100`);

    const fetchResult = await client.callTool({
      name: "fetch",
      arguments: { id: `${TARGET_GALLERY_ID}:100` },
    });
    expect((fetchResult.content[0] as { text: string }).text).toContain("Body text");
    expect((fetchResult.content[0] as { text: string }).text).toContain("Images");

    await transport.terminateSession();
    await client.close();
  });

  it("allows origin-less server-to-server MCP clients", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    const client = new McpClient({
      name: "originless-client",
      version: "1.0.0",
    });

    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(["search", "fetch"]);

    await transport.terminateSession();
    await client.close();
  });

  it("rejects disallowed origins", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });

    expect(response.status).toBe(403);
  });

  it("rejects unknown session ids", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "GET",
      headers: {
        Origin: "https://chat.openai.com",
        "Mcp-Session-Id": "does-not-exist",
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Unknown MCP session id"),
    });
  });
});
