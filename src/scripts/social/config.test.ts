import { describe, expect, it, vi } from "vitest";
import { getSocialMapping } from "./config";
import { configSchema } from "./schema";

vi.mock("../../data/social-posts.json", () => ({
  default: {
    "2026/10/example": {
      blueskyUrl: "https://bsky.app/profile/example.com/post/abc",
      blueskyUri: "at://did:plc:example/app.bsky.feed.post/abc",
      mastodonUrl: "https://mastodon.online/@name/123",
      linkedinUrl: "https://www.linkedin.com/feed/update/urn:li:share:789/",
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
  it("preserves generated LinkedIn URLs and allows a manual override", () => {
    expect(getSocialMapping("2026/10/example", {}).linkedinUrl).toContain("share:789");
    expect(getSocialMapping("2026/10/example", {
      linkedinUrl: "https://www.linkedin.com/feed/update/urn:li:ugcPost:456/",
    }).linkedinUrl).toContain("ugcPost:456");
  });
});

describe("LinkedIn configuration", () => {
  it("accepts a member URN and rejects an invalid identity", () => {
    const config = {
      enabled: true,
      productionOrigin: "https://example.com",
      archiveReady: false,
      linkedin: { personUrn: "urn:li:person:member-123" },
    };
    expect(configSchema.parse(config).linkedin).toEqual(config.linkedin);
    expect(() => configSchema.parse({
      ...config,
      linkedin: { personUrn: "urn:li:organization:123" },
    })).toThrow();
  });
});
