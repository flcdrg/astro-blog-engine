import { describe, expect, it } from "vitest";
import { archivePostId, legacyArchiveLink, legacyArchiveSchema, legacyCommentDate, orderLegacyComments } from "./archive";
import { sanitiseLegacyHtml } from "./archive-import";

describe("legacy archive", () => {
  const ids = new Set(["2025/07/a-post"]);
  it("matches only known canonical posts on the configured host", () => {
    for (const url of [
      "https://example.com/2025/07/a-post",
      "http://example.com/2025/07/a-post.html",
      "https://example.com/2025/07/a-post/",
    ]) expect(archivePostId(url, "https://example.com", ids)).toBe("2025/07/a-post");
    for (const url of [
      "https://other.example/2025/07/a-post", "https://example.com/2025/07/unknown",
      "javascript:alert(1)", "https://user:password@example.com/2025/07/a-post",
      "https://example.com/legacy-comments/2025/07/a-post", "https://example.com/2025/07/%2e%2e",
    ]) expect(archivePostId(url, "https://example.com", ids)).toBeUndefined();
  });

  it("contains no empty threads or private data and produces links only for populated threads", () => {
    expect(legacyArchiveSchema.parse({ version: 1, threads: {} })).toEqual({ version: 1, threads: {} });
    expect(() => legacyArchiveSchema.parse({ version: 1, threads: { "2025/07/a-post": [] } })).toThrow();
    expect(() => legacyArchiveSchema.parse({ version: 1, threads: { "2025/07/a-post": [{
      id: "1", name: "Name", html: "Content", createdAt: "2025-07-01T00:00:00Z", email: "private@example.com",
    }] } })).toThrow();
    expect(legacyArchiveLink("2025/07/a-post")).toBeUndefined();
  });

  it("sanitises markup and links, retaining only safe public content", () => {
    const html = sanitiseLegacyHtml('<p onclick="bad()">Hello <strong>world</strong><script>alert(1)</script><img src="x" onerror="bad()"></p><a href="javascript:bad()">bad</a><a href="https://user:secret@example.com">credential</a><a href="//example.com">relative</a><a href="https://example.com" target="_self">safe</a>');
    expect(html).not.toMatch(/script|onclick|onerror|<img|javascript|user:secret|href="\/\//);
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain('rel="nofollow noopener noreferrer"');
    expect(html).toContain('href="https://example.com/"');
  });

  it("orders chronologically and formats dates in Australia/Adelaide", () => {
    const comments = [
      { id: "later", name: "A", html: "A", createdAt: "2026-01-02T00:00:00Z" },
      { id: "earlier", name: "B", html: "B", createdAt: "2026-01-01T00:00:00Z" },
    ];
    expect(orderLegacyComments(comments).map((comment) => comment.id)).toEqual(["earlier", "later"]);
    expect(comments[0]?.id).toBe("later");
    expect(legacyCommentDate(comments[1]!.createdAt)).toContain("10:30");
  });
});
