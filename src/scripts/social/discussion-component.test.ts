import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { parse } from "node-html-parser";
import { afterEach, describe, expect, it, vi } from "vitest";
import SocialDiscussion from "../../components/SocialDiscussion.astro";
import MarkdownPostLayout from "../../layouts/MarkdownPostLayout.astro";
import LegacyCommentsPage from "../../pages/legacy-comments/[...slug].astro";
import { socialConfig } from "./config";

afterEach(() => vi.unstubAllEnvs());

describe("static discussion and archive markup", () => {
  it("renders no sections or fake counts without a mapping", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(SocialDiscussion, { props: { mapping: {} } });
    expect(parse(html).querySelector("[data-social-discussion]")).toBeNull();
    expect(html).not.toContain("0 likes");
  });

  it("renders both mapped networks with permanent no-script source links even when automatic publishing is disabled", async () => {
    const original = socialConfig.enabled;
    socialConfig.enabled = false;
    const container = await AstroContainer.create();
    const mapping = {
      blueskyUrl: "https://bsky.app/profile/author.example/post/root",
      mastodonUrl: "https://mastodon.online/@author/123",
    };
    try {
      const html = parse(await container.renderToString(SocialDiscussion, { props: { mapping } }));
      expect(html.querySelectorAll("[data-social-discussion]")).toHaveLength(2);
      expect(html.querySelector('a[href="https://bsky.app/profile/author.example/post/root"]')).not.toBeNull();
      expect(html.querySelector('a[href="https://mastodon.online/@author/123"]')).not.toBeNull();
      expect(html.querySelectorAll("noscript")).toHaveLength(2);
      expect(html.querySelectorAll('[data-discussion-retry][hidden]')).toHaveLength(2);
      expect(html.querySelectorAll('[role="status"]')).toHaveLength(2);
    } finally {
      socialConfig.enabled = original;
    }
  });

  it("renders just one provider when only it is mapped", async () => {
    const container = await AstroContainer.create();
    const html = parse(await container.renderToString(SocialDiscussion, {
      props: { mapping: { mastodonUrl: "https://mastodon.online/@author/123" } },
    }));
    expect(html.querySelectorAll("[data-social-discussion]")).toHaveLength(1);
    expect(html.querySelector('[data-provider="bluesky"]')).toBeNull();
  });

  it("keeps Disqus until archiveReady, then removes it without disabling manually mapped threads", async () => {
    vi.stubEnv("GITHUB_REF", "refs/heads/main");
    vi.stubEnv("GITHUB_REPOSITORY", "example/content");
    const original = socialConfig.archiveReady;
    const container = await AstroContainer.create();
    const props = {
      frontmatter: {
        title: "Discussion integration fixture", description: "A fixture for post discussion integration.",
        date: "2020-01-01T00:00:00Z", tags: [],
      },
      socialMapping: { mastodonUrl: "https://mastodon.online/@author/123" },
      legacyCommentsUrl: "/legacy-comments/2020/01/a-post",
    };
    try {
      socialConfig.archiveReady = false;
      const before = await container.renderToString(MarkdownPostLayout, { props });
      expect(before).toContain("davidgardiner.disqus.com/embed.js");
      socialConfig.archiveReady = true;
      const after = await container.renderToString(MarkdownPostLayout, { props });
      expect(after).not.toContain("davidgardiner.disqus.com/embed.js");
      expect(parse(after).querySelector('[data-provider="mastodon"]')).not.toBeNull();
      expect(parse(after).querySelector('a[href="/legacy-comments/2020/01/a-post"]')).not.toBeNull();
    } finally {
      socialConfig.archiveReady = original;
    }
  });

  it("renders a static read-only archive with noindex, its own canonical URL and sanitised comments", async () => {
    const container = await AstroContainer.create();
    const html = parse(await container.renderToString(LegacyCommentsPage, {
      request: new Request("https://david.gardiner.net.au/legacy-comments/2025/07/a-post"),
      props: { id: "2025/07/a-post", title: "Original post", comments: [
        { id: "1", name: "<script>name</script>", html: '<p onclick="bad()">Public comment<script>bad()</script></p>', createdAt: "2025-07-01T00:00:00Z" },
        { id: "2", parentId: "1", name: "Second author", html: "<p>A reply</p>", createdAt: "2025-07-01T01:00:00Z" },
      ] },
    }));
    expect(html.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, follow");
    expect(html.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://david.gardiner.net.au/legacy-comments/2025/07/a-post");
    expect(html.querySelectorAll(".legacy-comments li")).toHaveLength(2);
    expect(html.querySelector(".legacy-comments script")).toBeNull();
    expect(html.querySelector(".legacy-comments [onclick]")).toBeNull();
    expect(html.querySelector('a[href="#legacy-comment-0"]')).not.toBeNull();
    expect(html.querySelector('a[href="/2025/07/a-post"]')).not.toBeNull();
  });
});
