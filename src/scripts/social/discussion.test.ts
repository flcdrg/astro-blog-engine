import { describe, expect, it, vi } from "vitest";
import {
  decodeBlueskyDiscussion, decodeMastodonDiscussion, discussionDate,
  loadDiscussion, safeDiscussionUrl, MAX_REPLIES, MAX_LIKE_AVATARS,
} from "./discussion";

const author = { did: "did:plc:author", handle: "author.example", displayName: "Public author", avatar: "https://cdn.example/avatar.jpg" };
const rootUri = "at://did:plc:author/app.bsky.feed.post/root";
const blueskyPost = (id: string, date = "2026-01-01T00:00:00Z") => ({
  uri: `at://did:plc:author/app.bsky.feed.post/${id}`,
  author,
  record: { text: "<script>alert('plain text')</script>", createdAt: date },
  likeCount: 42, repostCount: 3, replyCount: 50,
});
const mastodonPost = (id: string, visibility = "public", parent = "1") => ({
  id, in_reply_to_id: parent, visibility,
  url: `https://social.example/@author/${id}`, created_at: "2026-01-01T00:00:00Z",
  content: "<p>Public reply</p>", spoiler_text: "",
  account: { display_name: "Public name", acct: "author", url: "https://social.example/@author", avatar: "https://social.example/avatar.png" },
  favourites_count: 9, replies_count: 4, reblogs_count: 2,
});

describe("public discussion boundaries", () => {
  it("does not present missing engagement counts as zero", () => {
    const { likeCount, replyCount, repostCount, ...post } = blueskyPost("root");
    const result = decodeBlueskyDiscussion({ thread: { post } }, { likes: [] });
    expect(result.likes).toBeUndefined();
    expect(result.replyCount).toBeUndefined();
    expect(result.reposts).toBeUndefined();
  });
  it("bounds and orders Bluesky replies/avatars and preserves reply relationships and text", () => {
    const child = { post: { ...blueskyPost("child"), record: {
      ...blueskyPost("child").record, reply: { parent: { uri: "at://did:plc:author/app.bsky.feed.post/parent" } },
    } } };
    const result = decodeBlueskyDiscussion({
      thread: { post: blueskyPost("root"), replies: [
        { post: blueskyPost("parent", "2025-12-31T23:59:00Z"), replies: [child] },
        ...Array.from({ length: 30 }, (_, i) => ({ post: blueskyPost(`reply${i}`, `2026-01-02T00:${String(i).padStart(2, "0")}:00Z`) })),
        { blocked: true }, { notFound: true }, { post: blueskyPost("parent") }, { post: { uri: "invalid" } },
      ] },
    }, { likes: Array.from({ length: 8 }, () => ({ actor: author })) });
    expect(result.replies).toHaveLength(MAX_REPLIES);
    expect(result.likeAuthors).toHaveLength(MAX_LIKE_AVATARS);
    expect(result.replies[0]?.id).toContain("/parent");
    expect(result.replies[1]?.parentId).toContain("/parent");
    expect(result.replies[1]?.text).toContain("<script>");
    expect(result.likes).toBe(42);
    expect(result.replyCount).toBe(50);
    expect(result.warnings).toEqual(["Some Bluesky replies contained invalid data and could not be displayed."]);
  });

  it("handles removed/blocked roots, malformed payloads and unavailable likes", () => {
    expect(() => decodeBlueskyDiscussion({ thread: { notFound: true } })).toThrow(/unavailable/);
    expect(() => decodeBlueskyDiscussion({ thread: { blocked: true } })).toThrow(/unavailable/);
    expect(() => decodeBlueskyDiscussion({ thread: { post: { uri: "bad" } } })).toThrow();
    const malformedLikes = decodeBlueskyDiscussion({ thread: { post: blueskyPost("root") } }, { likes: "bad" });
    expect(malformedLikes.likeAuthors).toEqual([]);
    expect(malformedLikes.warnings).toEqual(["The Bluesky likes preview contained invalid data and could not be displayed."]);
    expect(decodeBlueskyDiscussion({
      thread: { post: blueskyPost("root"), replies: [{ blocked: true }, { notFound: true }] },
    }, { likes: [] }).warnings).toEqual([]);
  });

  it("only previews public Mastodon replies and keeps content warnings and parents", () => {
    const result = decodeMastodonDiscussion(mastodonPost("1"), { descendants: [
      mastodonPost("90071992547409931234"),
      { ...mastodonPost("3", "public", "90071992547409931234"), spoiler_text: "A sensitive topic" },
      mastodonPost("4", "unlisted"), mastodonPost("5", "private"), mastodonPost("6", "direct"),
      { ...mastodonPost("7"), url: "javascript:alert(1)" },
      { ...mastodonPost("8"), id: 8 },
    ] });
    expect(result.replies).toHaveLength(2);
    expect(result.replies.find((reply) => reply.id === "3")?.warning).toBe("A sensitive topic");
    expect(result.replies.find((reply) => reply.id === "3")?.parentId).toBe("90071992547409931234");
    expect(result.replies.find((reply) => reply.id === "90071992547409931234")?.id).toBe("90071992547409931234");
    expect(result.warnings).toEqual(["Some public Mastodon replies contained invalid data and could not be displayed."]);
    expect(() => decodeMastodonDiscussion(mastodonPost("1", "unlisted"), { descendants: [] })).toThrow(/public/);
  });

  it("caps Mastodon replies, rejects unsafe avatars and uses Adelaide dates", () => {
    const result = decodeMastodonDiscussion(mastodonPost("1"), { descendants:
      Array.from({ length: 30 }, (_, i) => ({ ...mastodonPost(String(i + 2)),
        account: { ...mastodonPost("2").account, avatar: "data:image/svg+xml,unsafe" } })),
    });
    expect(result.replies).toHaveLength(MAX_REPLIES);
    expect(result.replies[0]?.author.avatar).toBeUndefined();
    expect(discussionDate("2026-01-01T00:00:00Z")).toContain("10:30");
    expect(safeDiscussionUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeDiscussionUrl("https://user:password@example.com/a")).toBeUndefined();
    expect(safeDiscussionUrl("https://example.com/a")).toBe("https://example.com/a");
  });
});

describe("public API loading", () => {
  it("resolves manual Bluesky handles once and omits credentials", async () => {
    const request = vi.fn(async (url: string, _init?: RequestInit) => new Response(JSON.stringify(
      url.includes("resolveHandle") ? { did: author.did }
        : url.includes("getLikes") ? { likes: [] }
          : { thread: { post: blueskyPost("root") } },
    )));
    const result = await loadDiscussion("bluesky", { blueskyUrl: "https://bsky.app/profile/author.example/post/root" }, request);
    expect(result.rootId).toBe(rootUri);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[1]?.[0]).toContain("depth=6");
    const init = request.mock.calls[0]?.[1];
    expect(init?.credentials).toBe("omit");
    expect(init?.referrerPolicy).toBe("no-referrer");
  });

  it("prefers a persisted DID identity and tolerates likes endpoint failure", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const urls: string[] = [];
    const request = async (url: string) => {
      urls.push(url);
      return url.includes("getLikes")
        ? new Response("", { status: 429 })
        : new Response(JSON.stringify({ thread: { post: blueskyPost("root"), replies: [{ post: blueskyPost("reply") }] } }));
    };
    try {
      const result = await loadDiscussion("bluesky", {
        blueskyUrl: "https://bsky.app/profile/author.example/post/root", blueskyUri: rootUri,
      }, request);
      expect(result.likeAuthors).toEqual([]);
      expect(result.replies).toHaveLength(1);
      expect(result.warnings).toEqual(["The Bluesky likes preview could not be loaded; reply data is still available."]);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("likes preview could not be loaded"));
      expect(urls).toHaveLength(2);
      expect(urls.some((url) => url.includes("resolveHandle"))).toBe(false);
    } finally {
      warning.mockRestore();
    }
  });

  it("rejects non-public Mastodon roots without fetching their context", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify(mastodonPost("1", "private"))));
    await expect(loadDiscussion("mastodon", { mastodonUrl: "https://social.example/@author/1" }, request)).rejects.toThrow(/public/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("reports HTTP failures and permits a fresh retry", async () => {
    let failed = true;
    const request = async (url: string) => {
      if (failed) return new Response("", { status: 503 });
      return new Response(JSON.stringify(url.endsWith("/context") ? { descendants: [] } : mastodonPost("1")));
    };
    const mapping = { mastodonUrl: "https://social.example/@author/1" };
    await expect(loadDiscussion("mastodon", mapping, request)).rejects.toThrow(/503/);
    failed = false;
    expect((await loadDiscussion("mastodon", mapping, request)).rootId).toBe("1");
  });

  it("rejects a returned root that differs from the mapped thread", async () => {
    const request = async (url: string) => new Response(JSON.stringify(
      url.endsWith("/context") ? { descendants: [] } : mastodonPost("2"),
    ));
    await expect(loadDiscussion("mastodon", {
      mastodonUrl: "https://social.example/@author/1",
    }, request)).rejects.toThrow(/different thread/);
  });

  it("aborts hung requests within the bounded timeout", async () => {
    const request = (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    await expect(loadDiscussion("mastodon", { mastodonUrl: "https://social.example/@author/1" }, request, 5)).rejects.toThrow(/aborted/);
  });
});
