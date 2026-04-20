import { describe, expect, it, vi } from "vitest";
import type { DcClient } from "../src/dc/client.js";
import { runFetchTool } from "../src/mcp/tools/fetch.js";
import { TARGET_GALLERY_ID } from "../src/types/dc.js";

function makeClient(): DcClient {
  return {
    listRecent: vi.fn(),
    searchGallery: vi.fn(),
    getPost: vi.fn(async () => ({
      id: `${TARGET_GALLERY_ID}:123`,
      postNo: "123",
      galleryId: TARGET_GALLERY_ID,
      title: "A fetched post",
      bodyText: "Body text",
      comments: [
        {
          author: "user1",
          text: "comment one",
        },
      ],
      imageUrls: ["https://example.com/image.jpg"],
      url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=123",
      author: "author1",
      createdAt: "2026-01-01",
      views: 11,
      upvotes: 7,
      commentCount: 1,
      raw: {},
    })),
  };
}

describe("runFetchTool", () => {
  it("returns body/comments/images/source URL fields", async () => {
    const client = makeClient();
    const response = await runFetchTool(client, { id: `${TARGET_GALLERY_ID}:123` });

    expect(client.getPost).toHaveBeenCalledWith("123");
    expect(response.content[0].text).toContain("Body text");
    expect(response.content[0].text).toContain("Comments");
    expect(response.content[0].text).toContain("Images");
    expect(response.content[0].text).toContain("https://example.com/image.jpg");
    expect(response.content[0].text).toContain("Source");
  });

  it("throws an error for malformed ids", async () => {
    const client = makeClient();
    await expect(runFetchTool(client, { id: "wrong:123" })).rejects.toThrow(/Only gallery/);
  });

  it("surfaces errors for nonexistent posts", async () => {
    const client = makeClient();
    vi.mocked(client.getPost).mockRejectedValueOnce(new Error("Post does not exist."));
    await expect(runFetchTool(client, { id: `${TARGET_GALLERY_ID}:999999999` })).rejects.toThrow(
      /does not exist/i,
    );
  });
});
