import type { DcClient } from "../../dc/client.js";
import { parseDocumentId } from "../../dc/normalize.js";
import type { FetchDocument } from "../../types/mcp.js";

const FETCH_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    id: {
      type: "string",
      description: "Document id in the format 'thesingularity:<postNo>'",
    },
  },
  required: ["id"],
  additionalProperties: false,
};

export const fetchToolDefinition = {
  name: "fetch",
  description: "Fetch one post from the DCInside '특이점이 온다' gallery.",
  inputSchema: FETCH_INPUT_SCHEMA,
};

export async function runFetchTool(client: DcClient, args: unknown) {
  const id = parseId(args);
  const postNo = parseDocumentId(id);
  const post = await client.getPost(postNo);

  const document: FetchDocument = {
    id: post.id,
    title: post.title,
    text: post.bodyText,
    url: post.url,
    metadata: {
      galleryId: post.galleryId,
      postNo: post.postNo,
      author: post.author ?? null,
      createdAt: post.createdAt ?? null,
      views: post.views ?? null,
      upvotes: post.upvotes ?? null,
      commentCount: post.commentCount ?? post.comments.length,
      imageCount: post.imageUrls.length,
    },
    comments: post.comments.map((comment) => ({
      author: comment.author ?? null,
      text: comment.text,
      createdAt: comment.createdAt ?? null,
    })),
    imageUrls: post.imageUrls,
  };

  return {
    content: [
      {
        type: "text" as const,
        text: formatDocumentText(document, post.comments.map((comment) => comment.depth ?? 0)),
      },
    ],
    structuredContent: document as unknown as Record<string, unknown>,
  };
}

function parseId(args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("The 'id' argument is required.");
  }

  const id = (args as Record<string, unknown>).id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error("The 'id' argument is required.");
  }

  return id.trim();
}

function formatDocumentText(document: FetchDocument, commentDepths: number[]): string {
  const headerMeta = [
    document.metadata.createdAt ?? "Unknown date",
    document.metadata.author ?? "Unknown author",
    `Views: ${document.metadata.views ?? "?"}`,
    `Upvotes: ${document.metadata.upvotes ?? "?"}`,
  ].join(" / ");

  const body = document.text.trim().length > 0 ? document.text : "(no body text)";
  const comments =
    document.comments.length > 0
      ? document.comments
          .map((comment, index) => {
            const indent = "  ".repeat(Math.min(commentDepths[index] ?? 0, 3));
            return `${indent}- ${comment.author ?? "anonymous"}: ${comment.text.replace(/\s+/g, " ").trim()}`;
          })
          .join("\n")
      : "- (none)";

  const images =
    document.imageUrls.length > 0
      ? document.imageUrls.map((url) => `- ${url}`).join("\n")
      : "- (none)";

  return [
    document.title,
    headerMeta,
    "",
    body,
    "",
    "Comments",
    comments,
    "",
    "Images",
    images,
    "",
    "Source",
    document.url,
  ].join("\n");
}
