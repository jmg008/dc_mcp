import type { DcClient } from "../../dc/client.js";
import { isRecentQuery } from "../../dc/normalize.js";
import { TARGET_GALLERY_ID } from "../../types/dc.js";
import type { SearchDocument } from "../../types/mcp.js";

const SEARCH_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Search keywords. Leave empty to fetch recent posts.",
    },
  },
  additionalProperties: false,
};

export const searchToolDefinition = {
  name: "search",
  description: "Search posts in the DCInside '특이점이 온다' minor gallery only.",
  inputSchema: SEARCH_INPUT_SCHEMA,
};

export async function runSearchTool(client: DcClient, args: unknown) {
  const query = parseQuery(args);
  const useRecent = isRecentQuery(query);
  const results = useRecent ? await client.listRecent(1) : await client.searchGallery(query);

  const documents: SearchDocument[] = results.slice(0, 30).map((item) => ({
    id: item.id,
    title: item.title,
    url: item.url,
    postNo: item.postNo,
    author: item.author ?? null,
    createdAt: item.createdAt ?? null,
    galleryId: item.galleryId,
  }));

  const text =
    documents.length === 0
      ? `No matching posts were found in "${TARGET_GALLERY_ID}".`
      : documents
          .map(
            (doc, index) =>
              `${index + 1}. ${doc.title}\n   id: ${doc.id}\n   url: ${doc.url}`,
          )
          .join("\n");

  return {
    content: [{ type: "text" as const, text }],
    structuredContent: {
      galleryId: TARGET_GALLERY_ID,
      query: useRecent ? "latest" : query,
      results: documents,
    },
  };
}

function parseQuery(args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return "";
  }

  const value = (args as Record<string, unknown>).query;
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}
