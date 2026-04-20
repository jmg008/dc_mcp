import { describe, expect, it } from "vitest";
import { createDcClient } from "../src/dc/client.js";
import { TARGET_GALLERY_ID } from "../src/types/dc.js";

const describeLive = process.env.RUN_LIVE_DC_TESTS === "1" ? describe : describe.skip;

describeLive("live dcinside integration", () => {
  const client = createDcClient({
    requestTimeoutMs: 20_000,
    recentCacheTtlMs: 1_000,
    postCacheTtlMs: 1_000,
    maxConcurrency: 2,
  });

  it(
    "returns only thesingularity posts for recent and search, then fetches one post with comments/images/url",
    async () => {
      const recent = await client.listRecent(1);
      expect(recent.length).toBeGreaterThan(0);
      expect(recent.every((item) => item.galleryId === TARGET_GALLERY_ID)).toBe(true);

      const search = await client.searchGallery("gpt");
      expect(search.length).toBeGreaterThan(0);
      expect(search.every((item) => item.galleryId === TARGET_GALLERY_ID)).toBe(true);

      const post = await client.getPost(recent[0].postNo);
      expect(post.galleryId).toBe(TARGET_GALLERY_ID);
      expect(post.url).toContain("gall.dcinside.com");
      expect(post.title.length).toBeGreaterThan(0);
      expect(Array.isArray(post.comments)).toBe(true);
      expect(Array.isArray(post.imageUrls)).toBe(true);
    },
    60_000,
  );
});
