import { describe, expect, it } from "vitest";
import { previewSchema, renderPreview } from "./preview";
import { formatAnnouncement } from "../../src/scripts/social/format";

const config = {
  enabled: false, productionOrigin: "https://example.com", archiveReady: false,
  bluesky: { handle: "example.com", service: "https://bsky.social" },
  mastodon: { origin: "https://mastodon.online", username: "name", maxCharacters: 500 },
};
const post = {
  id: "2026/10/example", source: "src/posts/2026/2026-10-01-example.md",
  url: "https://example.com/2026/10/example", title: "A useful blog post title",
  description: "How this feature works", tags: [".NET"],
  date: "2026-10-01T12:00:00+09:30", draft: false,
  image: { path: "/_astro/test.jpg", alt: "Useful image" },
};
describe("announcement PR previews", () => {
  it("uses production formatter and displays image/alt metadata", () => {
    const preview = previewSchema.parse({ version: 1, head: "a".repeat(40), posts: [post] });
    const body = renderPreview(preview, config);
    expect(body).toContain(formatAnnouncement(post, "bluesky").text);
    expect(body).toContain("Useful image");
    expect(body).toContain("/_astro/test.jpg");
  });
  it("clears stale examples when all posts are removed", () => {
    expect(renderPreview({ version: 1, head: "a".repeat(40), posts: [] }, config)).toContain("No new blog posts");
  });
  it("labels drafts and handles hostile fences", () => {
    const body = renderPreview({ version: 1, head: "a".repeat(40), posts: [{ ...post, draft: true, title: "```\\n@everyone" }] }, config);
    expect(body).toContain("Draft: will not publish");
    expect(body).not.toContain("@everyone");
    expect(body).toContain("````text");
  });
  it("rejects preview deployment URLs for announcement text", () => {
    expect(() => renderPreview({ version: 1, head: "a".repeat(40), posts: [{ ...post, url: "https://preview.example.com/post" }] }, config)).toThrow();
  });
  it("embeds images only from an explicitly trusted preview host", () => {
    const preview = { version: 1 as const, head: "a".repeat(40), posts: [post] };
    expect(renderPreview(preview, config, "https://untrusted.workers.dev")).not.toContain("![Planned");
    const trusted = { ...config, previewHostSuffix: "account.workers.dev" };
    expect(renderPreview(preview, trusted, "https://preview.account.workers.dev")).toContain("![Planned Mastodon attachment](https://preview.account.workers.dev/_astro/test.jpg)");
    expect(() => renderPreview(preview, trusted, "https://account.workers.dev.evil.com")).toThrow();
  });
});
