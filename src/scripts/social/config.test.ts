import { describe, expect, it, vi } from "vitest";
import { getSocialMapping } from "./config";

vi.mock("../../data/social-posts.json", () => ({
  default: {
    "2026/10/example": {
      blueskyUrl: "https://bsky.app/profile/example.com/post/abc",
      blueskyUri: "at://did:plc:example/app.bsky.feed.post/abc",
      mastodonUrl: "https://mastodon.online/@name/123",
    },
  },
}));

describe("manual social mapping precedence", () => {
  it("keeps generated identity when no override is supplied", () => {
    expect(getSocialMapping("2026/10/example", {}).blueskyUri).toBe("at://did:plc:example/app.bsky.feed.post/abc");
  });
  it("does not keep a stale DID URI when the thread is overridden", () => {
    const result = getSocialMapping("2026/10/example", { blueskyUrl: "https://bsky.app/profile/new.example/post/xyz" });
    expect(result.blueskyUri).toBeUndefined();
    expect(result.blueskyUrl).toContain("/xyz");
    expect(result.mastodonUrl).toContain("/123");
  });
  it("supports manual references for previously unmapped posts", () => {
    expect(getSocialMapping("2026/10/manual", { mastodonUrl: "https://mastodon.online/@name/456" })).toEqual({ mastodonUrl: "https://mastodon.online/@name/456" });
  });
});
