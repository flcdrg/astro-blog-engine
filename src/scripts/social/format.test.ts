import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { canonicalMatch, formatAnnouncement, isEligible, normaliseHashtag } from "./format";
import { parseThreadUrl, manifestPostSchema } from "./schema";

const post = {
  id: "2026/10/example", source: "src/posts/2026/2026-10-01-example.md",
  url: "https://example.com/2026/10/example", title: "A useful blog post title",
  description: "How this feature works", tags: [".NET", "C sharp", "others"],
  date: "2026-10-01T12:00:00+09:30", draft: false,
};
describe("social contracts and formatting", () => {
  it("formats announcements and normalises tags", () => {
    expect(formatAnnouncement(post, "bluesky").text).toBe("Blogged: A useful blog post title\n\nHow this feature works\n\nhttps://example.com/2026/10/example\n\n#dotnet #Csharp");
    expect(normaliseHashtag(".NET")).toBe("dotnet");
  });
  it("preserves URL and truncates grapheme-safely", () => {
    const result = formatAnnouncement({ ...post, description: "👨‍👩‍👧‍👦".repeat(400) }, "bluesky");
    expect(result.length).toBeLessThanOrEqual(300);
    expect(result.text).toContain(post.url);
    expect(result.warnings).toContain("Description shortened to fit the platform limit.");
  });
  it("uses reserved Mastodon URL length", () => {
    const result = formatAnnouncement({ ...post, url: post.url + "x".repeat(300) }, "mastodon");
    expect(result.length).toBeLessThan(150);
  });
  it("rejects malformed thread URLs and preserves string status IDs", () => {
    expect(parseThreadUrl("https://mastodon.online/@name/1234567890123456789", "mastodon").id).toBe("1234567890123456789");
    expect(() => parseThreadUrl("https://bsky.app.evil/profile/me/post/abc", "bluesky")).toThrow();
    expect(() => parseThreadUrl("https://name:pass@mastodon.online/@name/123", "mastodon")).toThrow();
  });
  it("excludes drafts and future posts", () => {
    const now = DateTime.fromISO("2026-10-03T12:00:00+09:30");
    expect(isEligible(post, now)).toBe(true);
    expect(isEligible({ ...post, draft: true }, now)).toBe(false);
    expect(isEligible({ ...post, date: "2026-11-01T12:00:00+09:30" }, now)).toBe(false);
  });
  it("matches only exact documented URL equivalents", () => {
    expect(canonicalMatch(post.url + ".html", "https://example.com")).toBe(post.url);
    expect(canonicalMatch(post.url + "/", "https://example.com")).toBe(post.url);
    expect(canonicalMatch(post.url + "?redirect=x", "https://example.com")).toBeUndefined();
    expect(canonicalMatch("https://evil.com/2026/10/example", "https://example.com")).toBeUndefined();
  });
  it("validates manifest shape", () => {
    expect(manifestPostSchema.parse(post)).toEqual(post);
    expect(() => manifestPostSchema.parse({ ...post, id: "../wrong" })).toThrow();
  });
  it("reports missing announcement descriptions rather than silently omitting them", () => {
    expect(() => formatAnnouncement({ ...post, description: "" }, "bluesky")).toThrow("needs a description");
  });
});
