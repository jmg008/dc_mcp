import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import type { DcClient } from "../dc/client.js";
import { fetchToolDefinition, runFetchTool } from "./tools/fetch.js";
import { searchToolDefinition, runSearchTool } from "./tools/search.js";

export interface CreateMcpServerOptions {
  dcClient: DcClient;
  logger?: (event: string, data?: Record<string, unknown>) => void;
}

export function createMcpServer(options: CreateMcpServerOptions): Server {
  const server = new Server(
    {
      name: "dcinside-thesingularity-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [searchToolDefinition, fetchToolDefinition],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const toolArgs = request.params.arguments;
    const startedAt = Date.now();

    try {
      switch (toolName) {
        case "search":
          return await runSearchTool(options.dcClient, toolArgs);
        case "fetch":
          return await runFetchTool(options.dcClient, toolArgs);
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool "${toolName}".`);
      }
    } catch (error) {
      options.logger?.("tool.error", {
        toolName,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Tool "${toolName}" failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  });

  return server;
}
