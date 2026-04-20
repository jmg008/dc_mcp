import { describe, expect, it } from "vitest";
import {
  normalizeComments,
  normalizePostPage,
  normalizeRecentResults,
  normalizeSearchResults,
  parseDocumentId,
} from "../src/dc/normalize.js";
import { TARGET_GALLERY_ID } from "../src/types/dc.js";

describe("dc normalization", () => {
  it("parses current list rows and skips notices", () => {
    const html = `
      <table>
        <tbody>
          <tr class="ub-content us-post" data-no="100" data-type="icon_notice">
            <td class="gall_tit"><a href="/mgallery/board/view/?id=thesingularity&no=100">공지</a></td>
          </tr>
          <tr class="ub-content us-post" data-no="101" data-type="icon_txt">
            <td class="gall_subject"><b></b></td>
            <td class="gall_tit">
              <a href="/mgallery/board/view/?id=thesingularity&no=101&page=1">일반 글</a>
              <a class="reply_numbox"><span class="reply_num">[3]</span></a>
            </td>
            <td class="gall_writer" data-nick="작성자"></td>
            <td class="gall_date" title="2026-04-20 14:41:43">14:41</td>
            <td class="gall_count">9</td>
            <td class="gall_recommend">1</td>
          </tr>
        </tbody>
      </table>
    `;

    expect(normalizeRecentResults(html)).toEqual([
      expect.objectContaining({
        id: `${TARGET_GALLERY_ID}:101`,
        postNo: "101",
        title: "일반 글",
        commentCount: 3,
        views: 9,
        upvotes: 1,
      }),
    ]);
  });

  it("parses current search markup and filters to thesingularity", () => {
    const html = `
      <ul>
        <li>
          <a href="https://m.dcinside.com/board/thesingularity/123">
            <div class="sch-lnk"><span class="tit">gpt 글</span></div>
            <div class="sch-lnk-sub"><span class="gallname-lnk">특이점이 온다 갤러리</span><span class="date">2026.04.20 14:17</span></div>
          </a>
        </li>
        <li>
          <a href="https://m.dcinside.com/board/chatgpt/999">
            <div class="sch-lnk"><span class="tit">다른 갤 글</span></div>
            <div class="sch-lnk-sub"><span class="gallname-lnk">챗지피티 갤러리</span><span class="date">2026.04.20 14:18</span></div>
          </a>
        </li>
      </ul>
    `;

    const results = normalizeSearchResults(html);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: `${TARGET_GALLERY_ID}:123`,
      postNo: "123",
      title: "gpt 글",
    });
  });

  it("parses a post page with empty body and required comment tokens", () => {
    const html = `
      <input id="comment_cnt" value="0">
      <input id="_GALLTYPE_" value="M">
      <input id="e_s_n_o" value="token123">
      <input id="board_type" value="">
      <input id="secret_article_key" value="">
      <div class="gallview_head">
        <h3 class="title"><span class="title_headtext">[일반]</span><span class="title_subject">본문 없는 글</span></h3>
        <div class="gall_writer" data-nick="작성자"></div>
        <span class="gall_date" title="2026-04-20 14:17:15">2026.04.20 14:17:15</span>
        <span class="gall_count">조회 11</span>
        <span class="gall_reply_num">추천 2</span>
        <span class="gall_comment">댓글 0</span>
      </div>
      <div class="write_div"></div>
    `;

    const parsed = normalizePostPage(html, "123");
    expect(parsed.post).toMatchObject({
      id: `${TARGET_GALLERY_ID}:123`,
      title: "본문 없는 글",
      bodyText: "",
      commentCount: 0,
      views: 11,
      upvotes: 2,
    });
    expect(parsed.commentRequestState.eSnO).toBe("token123");
  });

  it("parses deleted and reply comments from the comment api", () => {
    const response = {
      total_cnt: 2,
      comments: [
        {
          no: "1",
          name: "작성자",
          reg_date: "04.20 14:17:15",
          depth: 0,
          del_yn: "N",
          is_delete: "0",
          memo: "첫 댓글",
        },
        {
          no: "2",
          name: "익명",
          reg_date: "04.20 14:18:15",
          depth: 1,
          del_yn: "Y",
          is_delete: "1",
          memo: "이 댓글은 게시물 작성자가 삭제하였습니다.",
        },
      ],
    };

    const normalized = normalizeComments(response);
    expect(normalized.totalCount).toBe(2);
    expect(normalized.comments).toEqual([
      expect.objectContaining({ commentNo: "1", text: "첫 댓글", depth: 0, deleted: false }),
      expect.objectContaining({
        commentNo: "2",
        text: "이 댓글은 게시물 작성자가 삭제하였습니다.",
        depth: 1,
        deleted: true,
      }),
    ]);
  });

  it("rejects malformed ids and wrong gallery ids", () => {
    expect(() => parseDocumentId("wrong:1")).toThrow(/Only gallery/);
    expect(() => parseDocumentId("not-a-post")).toThrow(/Invalid id format/);
  });

  it("treats unavailable pages as unreadable posts", () => {
    const html = `<body>삭제된 게시물입니다.</body>`;
    expect(() => normalizePostPage(html, "999")).toThrow(/unavailable/i);
  });
});
