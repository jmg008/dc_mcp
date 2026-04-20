import * as cheerio from "cheerio";
import type { DcComment, DcListItem, DcPost } from "../types/dc.js";
import { TARGET_GALLERY_ID } from "../types/dc.js";

const RECENT_KEYWORDS = [
  "latest",
  "recent",
  "new",
  "newest",
  "today",
  "최신",
  "최근",
  "방금",
  "새글",
];

const SEARCH_RESULT_URL_RE = /\/board\/([a-z0-9_]+)\/(\d+)/i;

interface CommentApiShape {
  total_cnt?: number | string;
  comments?: unknown[];
}

interface CommentRequestState {
  commentPage: string;
  gallType: string;
  eSnO: string;
  secretArticleKey: string;
  boardType: string;
}

export interface ParsedPostPage {
  post: DcPost;
  commentRequestState: CommentRequestState;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

function requireNonEmpty(value: string | null | undefined, message: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(message);
  }

  return value.trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

export function stripHtml(input: string): string {
  return decodeHtmlEntities(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<div[^>]*>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function parseInteger(text: string | null | undefined): number | undefined {
  if (!text) {
    return undefined;
  }

  const parsed = Number(text.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function textOrNull(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveUrl(url: string | undefined, base = "https://gall.dcinside.com"): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url, base).toString();
  } catch {
    return undefined;
  }
}

function parseReplyCount(text: string | undefined): number | undefined {
  if (!text) {
    return undefined;
  }

  const match = text.match(/\[(\d+)\]/);
  return match ? Number(match[1]) : undefined;
}

function parseSearchResultHref(href: string): { galleryId: string; postNo: string } | null {
  const match = href.match(SEARCH_RESULT_URL_RE);
  if (!match) {
    return null;
  }

  return {
    galleryId: match[1],
    postNo: match[2],
  };
}

export function buildDocumentId(postNo: string, galleryId = TARGET_GALLERY_ID): string {
  return `${galleryId}:${postNo}`;
}

export function buildPostUrl(postNo: string, galleryId = TARGET_GALLERY_ID): string {
  return `https://gall.dcinside.com/mgallery/board/view/?id=${encodeURIComponent(galleryId)}&no=${encodeURIComponent(postNo)}`;
}

export function parseDocumentId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) {
    throw new Error("Document id is required.");
  }

  const withPrefix = trimmed.match(/^([a-z0-9_]+):(\d+)$/i);
  if (withPrefix) {
    const galleryId = withPrefix[1];
    const postNo = withPrefix[2];
    if (galleryId !== TARGET_GALLERY_ID) {
      throw new Error(`Only gallery "${TARGET_GALLERY_ID}" is supported.`);
    }

    return postNo;
  }

  const plainPostNo = trimmed.match(/^\d+$/);
  if (plainPostNo) {
    return plainPostNo[0];
  }

  throw new Error(`Invalid id format "${id}". Expected "${TARGET_GALLERY_ID}:<postNo>" or "<postNo>".`);
}

export function isRecentQuery(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (RECENT_KEYWORDS.includes(normalized)) {
    return true;
  }

  return /(?:latest|recent|newest|최신|최근|새글)/i.test(normalized);
}

export function looksUnavailable(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").toLowerCase();
  return (
    normalized.includes("삭제된 게시물") ||
    normalized.includes("접근이 제한") ||
    normalized.includes("차단된 게시물") ||
    normalized.includes("작성자가 삭제") ||
    normalized.includes("존재하지 않는 게시물")
  );
}

export function normalizeRecentResults(html: string): DcListItem[] {
  const $ = cheerio.load(html);
  const items = $("tr.ub-content.us-post[data-no]")
    .toArray()
    .map((element) => {
      const row = $(element);
      const postNo = requireNonEmpty(row.attr("data-no"), "List row is missing data-no.");
      const rowType = row.attr("data-type") ?? "";
      if (rowType === "icon_notice") {
        return null;
      }

      const titleLink = row.find("td.gall_tit a").first();
      const title = requireNonEmpty(titleLink.text(), `List row ${postNo} is missing a title.`);
      const url = resolveUrl(titleLink.attr("href")) ?? buildPostUrl(postNo);
      const createdAt = textOrNull(row.find("td.gall_date").attr("title") ?? row.find("td.gall_date").text());

      return {
        id: buildDocumentId(postNo),
        postNo,
        galleryId: TARGET_GALLERY_ID,
        title,
        url,
        subject: textOrNull(row.find("td.gall_subject b").text()),
        author: textOrNull(row.find("td.gall_writer").attr("data-nick") ?? row.find("td.gall_writer").text()),
        createdAt,
        commentCount: parseReplyCount(row.find(".reply_num").text()),
        views: parseInteger(row.find("td.gall_count").text()),
        upvotes: parseInteger(row.find("td.gall_recommend").text()),
        raw: {
          rowType,
          href: titleLink.attr("href") ?? null,
        },
      } as DcListItem;
    });

  return items.filter((item): item is DcListItem => item !== null);
}

export function normalizeSearchResults(html: string): DcListItem[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const items = $("a[href*='/board/']")
    .toArray()
    .map((element) => {
      const anchor = $(element);
      if (anchor.find(".sch-lnk").length === 0) {
        return null;
      }

      const href = anchor.attr("href");
      const parsedHref = href ? parseSearchResultHref(href) : null;
      if (!parsedHref) {
        return null;
      }

      if (parsedHref.galleryId !== TARGET_GALLERY_ID) {
        return null;
      }

      const dedupeKey = `${parsedHref.galleryId}:${parsedHref.postNo}`;
      if (seen.has(dedupeKey)) {
        return null;
      }
      seen.add(dedupeKey);

      const title = requireNonEmpty(anchor.find(".tit").text(), `Search result ${dedupeKey} is missing a title.`);
      return {
        id: buildDocumentId(parsedHref.postNo, parsedHref.galleryId),
        postNo: parsedHref.postNo,
        galleryId: parsedHref.galleryId,
        title,
        url: buildPostUrl(parsedHref.postNo, parsedHref.galleryId),
        createdAt: textOrNull(anchor.find(".sch-lnk-sub .date").text()),
        author: undefined,
        raw: {
          href,
          galleryName: anchor.find(".sch-lnk-sub .gallname-lnk").text().trim(),
        },
      } as DcListItem;
    });

  return items.filter((item): item is DcListItem => item !== null);
}

export function normalizePostPage(
  html: string,
  postNo: string,
  galleryId = TARGET_GALLERY_ID,
): ParsedPostPage {
  const $ = cheerio.load(html);
  const title = textOrNull($(".gallview_head .title_subject").first().text());
  const bodyHtml = $(".write_div").first().html()?.trim() ?? "";
  const unavailableText = stripHtml($("body").text());

  if (!title || looksUnavailable(unavailableText)) {
    throw new Error(`Post "${postNo}" is unavailable or cannot be read.`);
  }

  const commentPage = textOrNull($("#comment_cnt").val()?.toString()) ?? "0";
  const eSnO = textOrNull($("#e_s_n_o").val()?.toString());
  const gallType = textOrNull($("#_GALLTYPE_").val()?.toString()) ?? "M";
  const boardType = textOrNull($("#board_type").val()?.toString()) ?? "";
  const secretArticleKey = textOrNull($("#secret_article_key").val()?.toString()) ?? "";

  if (!eSnO) {
    throw new Error(`Post "${postNo}" is missing the comment request token.`);
  }

  const imageUrls = $(".write_div img")
    .toArray()
    .map((image) => $(image).attr("data-original") ?? $(image).attr("src"))
    .map((src) => resolveUrl(src, "https://gall.dcinside.com"))
    .filter((src): src is string => Boolean(src));

  const post: DcPost = {
    id: buildDocumentId(postNo, galleryId),
    postNo,
    galleryId,
    title,
    subject: textOrNull($(".gallview_head .title_headtext").first().text()?.replace(/^\[|\]$/g, "")),
    bodyText: bodyHtml ? stripHtml(bodyHtml) : "",
    comments: [],
    imageUrls,
    url: buildPostUrl(postNo, galleryId),
    author: textOrNull(
      $(".gallview_head .gall_writer").attr("data-nick") ??
        $(".gallview_head .gall_writer .nickname em").first().text(),
    ),
    createdAt: textOrNull($(".gallview_head .gall_date").first().attr("title")),
    views: parseInteger($(".gallview_head .gall_count").first().text()),
    upvotes: parseInteger($(".gallview_head .gall_reply_num").first().text()),
    commentCount: parseInteger($(".gallview_head .gall_comment").first().text()),
    raw: {
      bodyHtml,
    },
  };

  return {
    post,
    commentRequestState: {
      commentPage,
      gallType,
      eSnO,
      secretArticleKey,
      boardType,
    },
  };
}

export function normalizeComments(raw: unknown): { totalCount: number | undefined; comments: DcComment[] } {
  const record = asRecord(raw) as CommentApiShape | null;
  if (!record) {
    throw new Error("Comment response is malformed.");
  }

  const totalCount = asNumber(record.total_cnt ?? null) ?? undefined;
  const rawComments = Array.isArray(record.comments) ? record.comments : [];

  const comments = rawComments
    .map((item) => {
      const comment = asRecord(item);
      if (!comment) {
        return null;
      }

      const memo = asString(comment.memo) ?? "";
      const deleted = asString(comment.is_delete) === "1" || asString(comment.del_yn) === "Y";

      return {
        commentNo: asString(comment.no) ?? undefined,
        author: asString(comment.name) ?? undefined,
        text: stripHtml(memo),
        createdAt: asString(comment.reg_date) ?? undefined,
        depth: asNumber(comment.depth) ?? 0,
        deleted,
      } as DcComment;
    });

  return {
    totalCount,
    comments: comments.filter((comment): comment is DcComment => comment !== null),
  };
}

export function buildCommentRequestPayload(args: {
  boardId: string;
  postNo: string;
  state: CommentRequestState;
}): URLSearchParams {
  const { boardId, postNo, state } = args;

  return new URLSearchParams({
    id: boardId,
    no: postNo,
    cmt_id: boardId,
    cmt_no: postNo,
    focus_cno: "",
    focus_pno: "",
    e_s_n_o: state.eSnO,
    comment_page: "1",
    sort: "D",
    prevCnt: state.commentPage,
    board_type: state.boardType,
    _GALLTYPE_: state.gallType,
    secret_article_key: state.secretArticleKey,
  });
}
