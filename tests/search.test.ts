import { describe, expect, it, vi } from "vitest";
import type { DcClient } from "../src/dc/client.js";
import { runSearchTool } from "../src/mcp/tools/search.js";
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
        id: `${TARGET_GALLERY_ID}:200`,
        postNo: "200",
        galleryId: TARGET_GALLERY_ID,
        title: "gpt post",
        url: "https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=200",
        raw: {},
      },
    ]),
    getPost: vi.fn(),
  };
}

describe("runSearchTool", () => {
  it("returns recent posts when query is empty", async () => {
    const client = makeClient();
    const response = await runSearchTool(client, { query: "" });

    expect(client.listRecent).toHaveBeenCalledTimes(1);
    expect(client.searchGallery).not.toHaveBeenCalled();
    expect(response.content[0].text).toContain(`${TARGET_GALLERY_ID}:100`);
  });

  it("runs gallery search for non-empty query", async () => {
    const client = makeClient();
    const response = await runSearchTool(client, { query: "gpt" });

    expect(client.searchGallery).toHaveBeenCalledWith("gpt");
    expect(response.content[0].text).toContain(`${TARGET_GALLERY_ID}:200`);
    expect(response.structuredContent).toMatchObject({
      galleryId: TARGET_GALLERY_ID,
      query: "gpt",
    });
  });
});
