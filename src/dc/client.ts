import { Client } from "dcinside.js";
import type { DcListItem, DcPost } from "../types/dc.js";
import { TARGET_GALLERY_ID } from "../types/dc.js";
import { getRequestContext } from "../http/requestContext.js";
import {
  buildCommentRequestPayload,
  normalizeComments,
  normalizePostPage,
  normalizeRecentResults,
  normalizeSearchResults,
} from "./normalize.js";

const LIVE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface HttpTextResponse {
  data: string;
  headers: Record<string, unknown>;
}

export interface DcClient {
  listRecent: (page: number) => Promise<DcListItem[]>;
  listRecommended: (page: number) => Promise<DcListItem[]>;
  searchGallery: (query: string) => Promise<DcListItem[]>;
  getPost: (postNo: string) => Promise<DcPost>;
}

export interface DcClientOptions {
  recentCacheTtlMs?: number;
  postCacheTtlMs?: number;
  requestTimeoutMs?: number;
  maxConcurrency?: number;
  logger?: (event: string, data?: Record<string, unknown>) => void;
}

class Semaphore {
  private readonly queue: Array<() => void> = [];
  private activeCount = 0;

  public constructor(private readonly limit: number) {}

  public async use<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.activeCount < this.limit) {
      this.activeCount += 1;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.activeCount += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.activeCount -= 1;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }
}

class DcClientImpl implements DcClient {
  private readonly recentCache = new Map<number, CacheEntry<DcListItem[]>>();
  private readonly recommendedCache = new Map<number, CacheEntry<DcListItem[]>>();
  private readonly postCache = new Map<string, CacheEntry<DcPost>>();
  private readonly semaphore: Semaphore;
  private readonly recentCacheTtlMs: number;
  private readonly postCacheTtlMs: number;
  private readonly requestTimeoutMs: number;
  private readonly client = new Client();

  public constructor(private readonly options: DcClientOptions) {
    this.semaphore = new Semaphore(Math.max(1, options.maxConcurrency ?? 2));
    this.recentCacheTtlMs = Math.max(1000, options.recentCacheTtlMs ?? 45_000);
    this.postCacheTtlMs = Math.max(1000, options.postCacheTtlMs ?? 180_000);
    this.requestTimeoutMs = Math.max(1000, options.requestTimeoutMs ?? 15_000);
  }

  public async listRecent(page: number): Promise<DcListItem[]> {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const cached = this.readFromCache(this.recentCache, safePage);
    if (cached) {
      return cached;
    }

    const response = await this.fetchText(
      `https://gall.dcinside.com/mgallery/board/lists/?id=${TARGET_GALLERY_ID}&page=${safePage}`,
      "listRecent.page",
      { page: safePage },
    );

    const normalized = normalizeRecentResults(response.data);
    this.writeToCache(this.recentCache, safePage, normalized, this.recentCacheTtlMs);
    return normalized;
  }

  public async listRecommended(page: number): Promise<DcListItem[]> {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const cached = this.readFromCache(this.recommendedCache, safePage);
    if (cached) {
      return cached;
    }

    const response = await this.fetchText(buildRecommendedListUrl(safePage), "listRecommended.page", {
      page: safePage,
    });

    const normalized = normalizeRecentResults(response.data);
    this.writeToCache(this.recommendedCache, safePage, normalized, this.recentCacheTtlMs);
    return normalized;
  }

  public async searchGallery(query: string): Promise<DcListItem[]> {
    const response = await this.fetchText(
      `https://m.dcinside.com/search/gall_content?keyword=${encodeURIComponent(query)}&page=1`,
      "search.page",
      { query },
    );

    return normalizeSearchResults(response.data);
  }

  public async getPost(postNo: string): Promise<DcPost> {
    const cached = this.readFromCache(this.postCache, postNo);
    if (cached) {
      return cached;
    }

    const pageResponse = await this.fetchText(buildDesktopPostUrl(postNo), "post.page", { postNo });
    const parsedPage = normalizePostPage(pageResponse.data, postNo, TARGET_GALLERY_ID);

    const commentResponse = await this.fetchComments(postNo, parsedPage.commentRequestState, pageResponse.headers);
    const normalizedComments = normalizeComments(commentResponse);

    const post: DcPost = {
      ...parsedPage.post,
      comments: normalizedComments.comments,
      commentCount:
        normalizedComments.totalCount ??
        parsedPage.post.commentCount ??
        normalizedComments.comments.length,
      raw: {
        pageHeaders: {
          etag: pageResponse.headers.etag ?? null,
        },
        commentResponse,
      },
    };

    this.writeToCache(this.postCache, postNo, post, this.postCacheTtlMs);
    return post;
  }

  private async fetchText(
    url: string,
    operation: string,
    metadata: Record<string, unknown> = {},
  ): Promise<HttpTextResponse> {
    return this.callWithPolicy(operation, async () => {
      const response = await this.client.session.get<string>(url, {
        headers: {
          Referer: buildGalleryListUrl(),
          "User-Agent": LIVE_USER_AGENT,
        },
        responseType: "text",
      });
      return response;
    }, metadata);
  }

  private async fetchComments(
    postNo: string,
    state: ReturnType<typeof normalizePostPage>["commentRequestState"],
    pageHeaders: Record<string, unknown>,
  ): Promise<unknown> {
    const cookies = collectCookies(pageHeaders["set-cookie"]);
    const payload = buildCommentRequestPayload({
      boardId: TARGET_GALLERY_ID,
      postNo,
      state,
    });

    return this.callWithPolicy("post.comments", async () => {
      const response = await this.client.session.post(
        "https://gall.dcinside.com/board/comment/",
        payload.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            Referer: buildDesktopPostUrl(postNo),
            "User-Agent": LIVE_USER_AGENT,
            ...(cookies ? { Cookie: cookies } : {}),
          },
        },
      );

      return response.data;
    }, { postNo });
  }

  private async callWithPolicy<T>(
    operation: string,
    work: () => Promise<T>,
    metadata: Record<string, unknown> = {},
  ): Promise<T> {
    const startedAt = Date.now();
    return this.semaphore.use(async () => {
      try {
        const result = await retryOnce(
          () => withTimeout(work, this.requestTimeoutMs, `${operation} timed out.`),
          (error) => isRetryableError(error),
        );

        this.options.logger?.("dc.success", {
          ...getRequestContext(),
          operation,
          galleryId: TARGET_GALLERY_ID,
          ...metadata,
          latencyMs: Date.now() - startedAt,
        });

        return result;
      } catch (error) {
        this.options.logger?.("dc.error", {
          ...getRequestContext(),
          operation,
          galleryId: TARGET_GALLERY_ID,
          ...metadata,
          latencyMs: Date.now() - startedAt,
          error: toErrorMessage(error),
        });
        throw error;
      }
    });
  }

  private readFromCache<TKey, TValue>(
    cache: Map<TKey, CacheEntry<TValue>>,
    key: TKey,
  ): TValue | null {
    const entry = cache.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      cache.delete(key);
      return null;
    }

    return entry.value;
  }

  private writeToCache<TKey, TValue>(
    cache: Map<TKey, CacheEntry<TValue>>,
    key: TKey,
    value: TValue,
    ttlMs: number,
  ): void {
    cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }
}

function buildGalleryListUrl(): string {
  return `https://gall.dcinside.com/mgallery/board/lists/?id=${TARGET_GALLERY_ID}`;
}

function buildRecommendedListUrl(page: number): string {
  return `https://gall.dcinside.com/mgallery/board/lists/?id=${TARGET_GALLERY_ID}&exception_mode=recommend&page=${page}`;
}

function buildDesktopPostUrl(postNo: string): string {
  return `https://gall.dcinside.com/mgallery/board/view/?id=${TARGET_GALLERY_ID}&no=${postNo}`;
}

function collectCookies(rawSetCookieHeader: unknown): string {
  if (!Array.isArray(rawSetCookieHeader)) {
    return "";
  }

  return rawSetCookieHeader
    .map((cookie) => (typeof cookie === "string" ? cookie.split(";")[0] : ""))
    .filter((cookie) => cookie.length > 0)
    .join("; ");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryableError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  if (message.includes("timed out")) {
    return true;
  }

  const maybeCode = (error as { code?: string } | null)?.code;
  if (!maybeCode) {
    return /network|socket|econn|reset|temporarily unavailable|eai_again/.test(message);
  }

  return ["ETIMEDOUT", "ECONNRESET", "ECONNABORTED", "EAI_AGAIN", "ENETDOWN"].includes(maybeCode);
}

async function retryOnce<T>(work: () => Promise<T>, shouldRetry: (error: unknown) => boolean): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!shouldRetry(error)) {
      throw error;
    }

    return work();
  }
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

export function createDcClient(options: DcClientOptions = {}): DcClient {
  return new DcClientImpl(options);
}
