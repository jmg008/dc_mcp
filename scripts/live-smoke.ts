import { createDcClient } from "../src/dc/client.js";

const client = createDcClient({
  requestTimeoutMs: 20_000,
  recentCacheTtlMs: 1_000,
  postCacheTtlMs: 1_000,
  maxConcurrency: 2,
});

const recent = await client.listRecent(1);
if (recent.length === 0) {
  throw new Error("No recent posts were returned from thesingularity.");
}

const search = await client.searchGallery("gpt");
const post = await client.getPost(recent[0].postNo);

process.stdout.write(
  JSON.stringify(
    {
      recentCount: recent.length,
      firstRecent: {
        id: recent[0].id,
        title: recent[0].title,
      },
      searchCount: search.length,
      firstSearch: search[0]
        ? {
            id: search[0].id,
            title: search[0].title,
          }
        : null,
      fetchedPost: {
        id: post.id,
        title: post.title,
        commentCount: post.commentCount ?? post.comments.length,
        imageCount: post.imageUrls.length,
        url: post.url,
      },
    },
    null,
    2,
  ),
);
