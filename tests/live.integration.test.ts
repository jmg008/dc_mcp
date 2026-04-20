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
    "returns only thesingularity recommended posts for the last 24 hours, then fetches one post with comments/images/url",
    async () => {
      const recommended = await client.listRecommended(1);
      expect(recommended.length).toBeGreaterThan(0);
      expect(recommended.every((item) => item.galleryId === TARGET_GALLERY_ID)).toBe(true);

      expect(
        recommended.some((item) => typeof item.createdAt === "string" && item.createdAt.trim().length > 0),
      ).toBe(true);

      const post = await client.getPost(recommended[0].postNo);
      expect(post.galleryId).toBe(TARGET_GALLERY_ID);
      expect(post.url).toContain("gall.dcinside.com");
      expect(post.title.length).toBeGreaterThan(0);
      expect(Array.isArray(post.comments)).toBe(true);
      expect(Array.isArray(post.imageUrls)).toBe(true);
    },
    60_000,
  );
});
