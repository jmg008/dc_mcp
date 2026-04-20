import { afterEach, describe, expect, it, vi } from "vitest";
import type { DcClient } from "../src/dc/client.js";
import { runSearchTool } from "../src/mcp/tools/search.js";
import { TARGET_GALLERY_ID } from "../src/types/dc.js";

function makeClient(): DcClient {
  return {
    listRecent: vi.fn(),
    listRecommended: vi.fn(async (page: number) => {
      if (page === 1) {
        return [
          {
            id: `${TARGET_GALLERY_ID}:100`,
            postNo: "100",
            galleryId: TARGET_GALLERY_ID,
            title: "최근 개념글",
            url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=100",
            createdAt: "2026-04-20 11:00:00",
            author: "작성자",
            raw: {},
          },
          {
            id: `${TARGET_GALLERY_ID}:101`,
            postNo: "101",
            galleryId: TARGET_GALLERY_ID,
            title: "오래된 개념글",
            url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=101",
            createdAt: "2026-04-18 09:00:00",
            author: "작성자2",
            raw: {},
          },
        ];
      }

      return [];
    }),
    searchGallery: vi.fn(),
    getPost: vi.fn(async (postNo: string) => ({
      id: `${TARGET_GALLERY_ID}:${postNo}`,
      postNo,
      galleryId: TARGET_GALLERY_ID,
      title: "경계 개념글",
      bodyText: "본문",
      comments: [],
      imageUrls: [],
      url: `https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=${postNo}`,
      author: "보정작성자",
      createdAt: "2026-04-20 12:00:00",
      raw: {},
    })),
  };
}

describe("runSearchTool", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns recommended posts from the last 24 hours by default", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T03:00:00+09:00"));

    const client = makeClient();
    const response = await runSearchTool(client, {});

    expect(client.listRecommended).toHaveBeenCalledWith(1);
    expect(client.listRecommended).toHaveBeenCalledTimes(1);
    expect(response.content[0].text).toContain(`${TARGET_GALLERY_ID}:100`);
    expect(response.content[0].text).not.toContain(`${TARGET_GALLERY_ID}:101`);
    expect(response.structuredContent).toMatchObject({
      galleryId: TARGET_GALLERY_ID,
      mode: "recommend",
      hours: 24,
      results: [expect.objectContaining({ id: `${TARGET_GALLERY_ID}:100` })],
    });
  });

  it("refines boundary date-only rows with fetch before deciding inclusion", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T00:30:00+09:00"));

    const client = makeClient();
    vi.mocked(client.listRecommended).mockResolvedValueOnce([
      {
        id: `${TARGET_GALLERY_ID}:200`,
        postNo: "200",
        galleryId: TARGET_GALLERY_ID,
        title: "경계 개념글",
        url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=200",
        createdAt: "04.20",
        raw: {},
      },
    ]);

    const response = await runSearchTool(client, { hours: 24 });
    expect(client.getPost).toHaveBeenCalledWith("200");
    expect(response.content[0].text).toContain(`${TARGET_GALLERY_ID}:200`);
    expect(response.content[0].text).toContain("2026-04-20 12:00:00");
  });

  it("rejects invalid hours values", async () => {
    const client = makeClient();
    await expect(runSearchTool(client, { hours: 0 })).rejects.toThrow(/between 1 and 168/);
    await expect(runSearchTool(client, { hours: 169 })).rejects.toThrow(/between 1 and 168/);
    await expect(runSearchTool(client, { hours: "24" })).rejects.toThrow(/between 1 and 168/);
  });
});
