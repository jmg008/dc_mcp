import type { DcClient } from "../../dc/client.js";
import type { DcListItem } from "../../types/dc.js";
import { TARGET_GALLERY_ID } from "../../types/dc.js";
import type { SearchDocument } from "../../types/mcp.js";

const SEARCH_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    hours: {
      type: "integer",
      description: "Return only recommended posts created within the last N hours.",
      minimum: 1,
    },
  },
  additionalProperties: false,
};

const DEFAULT_HOURS = 24;
const MAX_HOURS = 168;
const MAX_PAGES = 10;
const MAX_RESULTS = 50;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type ParsedTimestamp =
  | {
      precision: "exact";
      startMs: number;
      endMs: number;
      normalized: string;
    }
  | {
      precision: "dateOnly";
      startMs: number;
      endMs: number;
      normalized: string;
    }
  | {
      precision: "unknown";
    };

type ItemResolution = {
  include: boolean;
  stop: boolean;
  item: DcListItem;
};

export const searchToolDefinition = {
  name: "search",
  description: "List recommended posts from the DCInside '특이점이 온다' gallery within the last N hours.",
  inputSchema: SEARCH_INPUT_SCHEMA,
};

export async function runSearchTool(client: DcClient, args: unknown) {
  const hours = parseHours(args);
  const results = await collectRecommendedWithinHours(client, hours, new Date());

  const documents: SearchDocument[] = results.map((item) => ({
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
      ? `No recommended posts were found in "${TARGET_GALLERY_ID}" within the last ${hours} hours.`
      : documents
          .map((doc, index) => {
            const createdAt = doc.createdAt ?? "unknown";
            const author = doc.author ?? "anonymous";
            return `${index + 1}. ${doc.title}\n   id: ${doc.id}\n   createdAt: ${createdAt}\n   author: ${author}\n   url: ${doc.url}`;
          })
          .join("\n");

  return {
    content: [{ type: "text" as const, text }],
    structuredContent: {
      galleryId: TARGET_GALLERY_ID,
      mode: "recommend",
      hours,
      results: documents,
    },
  };
}

async function collectRecommendedWithinHours(
  client: DcClient,
  hours: number,
  now: Date,
): Promise<DcListItem[]> {
  const cutoffMs = now.getTime() - hours * 60 * 60 * 1000;
  const results: DcListItem[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const items = await client.listRecommended(page);
    if (items.length === 0) {
      break;
    }

    for (const item of items) {
      const resolved = await resolveRecommendedItem(client, item, cutoffMs, now);
      if (resolved.include) {
        results.push(resolved.item);
        if (results.length >= MAX_RESULTS) {
          return results;
        }
      }

      if (resolved.stop) {
        return results;
      }
    }
  }

  return results;
}

async function resolveRecommendedItem(
  client: DcClient,
  item: DcListItem,
  cutoffMs: number,
  now: Date,
): Promise<ItemResolution> {
  const parsed = parseListTimestamp(item.createdAt, now);
  return resolveWithParsedTimestamp(client, item, parsed, cutoffMs, now);
}

async function resolveWithParsedTimestamp(
  client: DcClient,
  item: DcListItem,
  parsed: ParsedTimestamp,
  cutoffMs: number,
  now: Date,
): Promise<ItemResolution> {
  if (parsed.precision === "unknown") {
    return resolveUsingPostPage(client, item, cutoffMs, now);
  }

  if (parsed.endMs < cutoffMs) {
    return {
      include: false,
      stop: true,
      item: parsed.normalized === item.createdAt ? item : { ...item, createdAt: parsed.normalized },
    };
  }

  if (parsed.startMs >= cutoffMs) {
    return {
      include: true,
      stop: false,
      item: parsed.normalized === item.createdAt ? item : { ...item, createdAt: parsed.normalized },
    };
  }

  return resolveUsingPostPage(client, item, cutoffMs, now);
}

async function resolveUsingPostPage(
  client: DcClient,
  item: DcListItem,
  cutoffMs: number,
  now: Date,
): Promise<ItemResolution> {
  const post = await client.getPost(item.postNo);
  const parsed = parseListTimestamp(post.createdAt ?? item.createdAt, now);
  const updatedItem: DcListItem = {
    ...item,
    author: item.author ?? post.author,
    createdAt:
      parsed.precision === "unknown"
        ? post.createdAt ?? item.createdAt
        : parsed.normalized,
  };

  if (parsed.precision === "unknown") {
    return {
      include: false,
      stop: false,
      item: updatedItem,
    };
  }

  return {
    include: parsed.endMs >= cutoffMs,
    stop: parsed.endMs < cutoffMs,
    item: updatedItem,
  };
}

function parseHours(args: unknown): number {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return DEFAULT_HOURS;
  }

  const value = (args as Record<string, unknown>).hours;
  if (value === undefined || value === null || value === "") {
    return DEFAULT_HOURS;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`The 'hours' argument must be an integer between 1 and ${MAX_HOURS}.`);
  }

  if (value < 1 || value > MAX_HOURS) {
    throw new Error(`The 'hours' argument must be an integer between 1 and ${MAX_HOURS}.`);
  }

  return value;
}

function parseListTimestamp(value: string | undefined, now: Date): ParsedTimestamp {
  const trimmed = value?.trim();
  if (!trimmed) {
    return { precision: "unknown" };
  }

  const fullDateTime = trimmed.match(
    /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (fullDateTime) {
    const [, year, month, day, hour, minute, second] = fullDateTime;
    const date = makeKstDate(
      Number(year),
      Number(month),
      Number(day),
      Number(hour),
      Number(minute),
      Number(second ?? "0"),
    );
    return {
      precision: "exact",
      startMs: date.getTime(),
      endMs: date.getTime(),
      normalized: formatKstDateTime(date),
    };
  }

  const timeOnly = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (timeOnly) {
    const [, hour, minute] = timeOnly;
    const nowKst = getKstDateParts(now);
    let candidate = makeKstDate(
      nowKst.year,
      nowKst.month,
      nowKst.day,
      Number(hour),
      Number(minute),
      0,
    );
    if (candidate.getTime() > now.getTime() + 60_000) {
      candidate = new Date(candidate.getTime() - DAY_MS);
    }

    return {
      precision: "exact",
      startMs: candidate.getTime(),
      endMs: candidate.getTime(),
      normalized: formatKstDateTime(candidate),
    };
  }

  const shortDate = trimmed.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (shortDate) {
    const [, month, day] = shortDate;
    const nowKst = getKstDateParts(now);
    let year = nowKst.year;
    let start = makeKstDate(year, Number(month), Number(day), 0, 0, 0);
    if (start.getTime() > now.getTime() + DAY_MS) {
      year -= 1;
      start = makeKstDate(year, Number(month), Number(day), 0, 0, 0);
    }

    return {
      precision: "dateOnly",
      startMs: start.getTime(),
      endMs: start.getTime() + DAY_MS - 1,
      normalized: formatKstDate(start),
    };
  }

  const dottedDate = trimmed.match(/^(\d{2}|\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (dottedDate) {
    const [, yearPart, month, day] = dottedDate;
    const year = yearPart.length === 2 ? 2000 + Number(yearPart) : Number(yearPart);
    const start = makeKstDate(year, Number(month), Number(day), 0, 0, 0);
    return {
      precision: "dateOnly",
      startMs: start.getTime(),
      endMs: start.getTime() + DAY_MS - 1,
      normalized: formatKstDate(start),
    };
  }

  return { precision: "unknown" };
}

function getKstDateParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

function makeKstDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute, second));
}

function formatKstDateTime(date: Date): string {
  const parts = getKstDateParts(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

function formatKstDate(date: Date): string {
  const parts = getKstDateParts(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
