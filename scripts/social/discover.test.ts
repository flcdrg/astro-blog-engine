import { describe, expect, it } from "vitest";

import { discover, discoveryCheckpointSchema } from "./discover";
import { createMastodonReader } from "./providers";
import type { BlueskyFeedPost, BlueskyReader, MastodonReader, MastodonStatus } from "./providers";
import type { ManifestPost, SocialConfig } from "../../src/scripts/social/schema";

const origin = "https://david.gardiner.net.au";
const config: SocialConfig = {
  enabled: false,
  productionOrigin: origin,
  bluesky: { handle: "david.gardiner.net.au", service: "https://bsky.social" },
  mastodon: { origin: "https://mastodon.online", username: "david", maxCharacters: 500 },
  archiveReady: false,
};

function post(id: string, url = `${origin}/${id.replaceAll("/", "/")}`): ManifestPost {
  return {
    id,
    source: `src/posts/${id.slice(0, 4)}/2026-10-03-${id.split("/").at(-1)}.md`,
    url,
    title: `Post ${id}`,
    description: "A short test post.",
    tags: ["testing"],
    date: "2026-10-03T12:00:00+09:30",
    draft: false,
  };
}

function blueskyPost(id: string, link: string): BlueskyFeedPost {
  const rkey = `tid${id.replaceAll("/", "")}`;
  return {
    post: {
      uri: `at://did:plc:author/app.bsky.feed.post/${rkey}`,
      author: { did: "did:plc:author" },
      record: {
        facets: [{
          features: [{ $type: "app.bsky.richtext.facet#link", uri: link }],
        }],
      },
    },
  };
}

function mastodonStatus(id: string, link: string): MastodonStatus {
  return {
    id,
    url: `https://mastodon.online/@david/${id}`,
    content: `<p>Blogged: <a href="${link}">${link}</a></p>`,
    created_at: "2026-10-03T01:00:00.000Z",
    visibility: "public",
    account: { id: "account-1", acct: "david", username: "david" },
  };
}

function readerForBluesky(pages: Array<{ feed: BlueskyFeedPost[]; cursor?: string }>): BlueskyReader {
  let index = 0;
  return {
    did: "did:plc:author",
    async getAuthorFeed() {
      return pages[index++] ?? { feed: [] };
    },
  };
}

function readerForMastodon(pages: MastodonStatus[][]): MastodonReader {
  let index = 0;
  return {
    account: { id: "account-1", acct: "david", username: "david" },
    async getStatuses() {
      return pages[index++] ?? [];
    },
  };
}

describe("discover", () => {
  it("reports malformed Mastodon API history as incomplete rather than proving absence", async () => {
    const target = post("2026/10/one");
    const result = await discover({ ...config, bluesky: undefined }, [target], {
      createMastodonReader: async (configuration) => createMastodonReader(configuration, {
        fetch: async (input) => Response.json(String(input).includes("lookup")
          ? { id: "123", acct: "david", username: "david" }
          : [{ id: "999", visibility: "public", account: { id: "123" } }]),
      }),
    });
    expect(result.complete).toBe(false);
    expect(result.mappings).toEqual({});
    expect(result.errors.mastodon).toContain("malformed provider payload");
    expect(result.unmatched).toEqual([{ postId: target.id, provider: "mastodon", reason: "history-incomplete" }]);
  });

  it("paginates Bluesky history and exactly associates canonical URL variants", async () => {
    const first = post("2026/10/one", `${origin}/2026/10/one`);
    const second = post("2026/10/two", `${origin}/2026/10/two.html`);
    const result = await discover({ ...config, mastodon: undefined }, [first, second], {
      createBlueskyReader: async () => readerForBluesky([
        { feed: [blueskyPost("one", `${origin}/2026/10/one.html`)], cursor: "next" },
        { feed: [blueskyPost("two", `${origin}/2026/10/two/`)] },
      ]),
    });

    expect(result.complete).toBe(true);
    expect(result.mappings[first.id]).toEqual({
      blueskyUri: "at://did:plc:author/app.bsky.feed.post/tidone",
      blueskyUrl: "https://bsky.app/profile/david.gardiner.net.au/post/tidone",
    });
    expect(result.mappings[second.id]?.blueskyUri).toContain("tidtwo");
    expect(result.unmatched).toEqual([]);
  });

  it("requires a full restart rather than claiming uniqueness from cursor-only resumption", async () => {
    const first = post("2026/10/one");
    const second = post("2026/10/two");
    const initial = await discover({ ...config, mastodon: undefined }, [first, second], {
      maxPages: 1,
      createBlueskyReader: async () => readerForBluesky([{
        feed: [blueskyPost("one", first.url)],
        cursor: "resume-after-one",
      }]),
    });

    expect(initial.complete).toBe(false);
    expect(initial.restartRequired).toBe(false);
    expect(initial.resume.blueskyCursor).toBe("resume-after-one");
    expect(initial.mappings).toEqual({});
    expect(initial.unmatched).toHaveLength(2);

    await expect(discover({ ...config, mastodon: undefined }, [first, second], {
      mappings: initial.mappings,
      resume: initial.resume,
      createBlueskyReader: async () => readerForBluesky([{
        feed: [blueskyPost("two", second.url)],
      }]),
    })).rejects.toThrow(/restart a full history scan/);
  });

  it("accumulates distinct announcements across chunks before deciding a canonical match is unique", async () => {
    const target = post("2026/10/one");
    const initial = await discover({ ...config, mastodon: undefined }, [target], {
      maxPages: 1,
      createBlueskyReader: async () => readerForBluesky([{
        feed: [blueskyPost("first", target.url)],
        cursor: "second-chunk",
      }]),
    });
    expect(initial.complete).toBe(false);
    expect(initial.mappings).toEqual({});
    expect(initial.checkpoint.providers.bluesky?.candidates[target.id]).toHaveLength(1);
    let receivedCursor: string | undefined;
    const resumed = await discover({ ...config, mastodon: undefined }, [target], {
      checkpoint: initial.checkpoint,
      createBlueskyReader: async () => ({
        did: "did:plc:author",
        async getAuthorFeed(cursor) {
          receivedCursor = cursor;
          return { feed: [blueskyPost("second", target.url)] };
        },
      }),
    });
    expect(receivedCursor).toBe("second-chunk");
    expect(resumed.complete).toBe(true);
    expect(resumed.mappings).toEqual({});
    expect(resumed.ambiguous).toEqual([{
      postId: target.id, provider: "bluesky",
      candidates: [
        "at://did:plc:author/app.bsky.feed.post/tidfirst",
        "at://did:plc:author/app.bsky.feed.post/tidsecond",
      ],
    }]);
    expect(initial.checkpoint.providers.bluesky?.candidates[target.id]).toHaveLength(1);
  });

  it("skips completed providers and resumes Mastodon with accumulated candidates and deduplication", async () => {
    const target = post("2026/10/one");
    const fullPage = Array.from({ length: 40 }, (_, index) =>
      mastodonStatus(String(1000 - index), index === 0 ? target.url : `${origin}/unrelated/${index}`));
    const initial = await discover(config, [target], {
      maxPages: 1,
      createBlueskyReader: async () => readerForBluesky([{ feed: [blueskyPost("first", target.url)] }]),
      createMastodonReader: async () => readerForMastodon([fullPage]),
    });
    expect(initial.complete).toBe(false);
    expect(initial.checkpoint.providers.bluesky?.complete).toBe(true);
    expect(initial.mappings[target.id]?.blueskyUrl).toContain("tidfirst");
    expect(initial.mappings[target.id]?.mastodonUrl).toBeUndefined();
    let receivedCursor: string | undefined;
    const resumed = await discover(config, [target], {
      checkpoint: JSON.parse(JSON.stringify(initial.checkpoint)),
      createBlueskyReader: async () => { throw new Error("completed provider must not be scanned"); },
      createMastodonReader: async () => ({
        account: { id: "account-1", acct: "david", username: "david" },
        async getStatuses(cursor) {
          receivedCursor = cursor;
          return [fullPage[0]!];
        },
      }),
    });
    expect(receivedCursor).toBe("961");
    expect(resumed.complete).toBe(true);
    expect(resumed.errors).toEqual({});
    expect(resumed.ambiguous).toEqual([]);
    expect(resumed.mappings[target.id]?.mastodonUrl).toBe("https://mastodon.online/@david/1000");
    expect(resumed.checkpoint.providers.mastodon?.candidates[target.id]).toHaveLength(1);
    expect(resumed.checkpoint.providers.mastodon?.cursor).toBeUndefined();
  });

  it("rejects malformed and differently scoped checkpoints before any history request", async () => {
    const target = post("2026/10/one");
    const initial = await discover({ ...config, mastodon: undefined }, [target], {
      createBlueskyReader: async () => readerForBluesky([{ feed: [] }]),
    });
    expect(() => discoveryCheckpointSchema.parse({ ...initial.checkpoint, accessToken: "must-not-be-stored" })).toThrow();
    for (const [changedConfig, changedPosts] of [
      [{ ...config, mastodon: undefined, bluesky: { ...config.bluesky!, handle: "another.example" } }, [target]],
      [{ ...config, mastodon: undefined }, [{ ...target, url: `${origin}/changed` }]],
    ] as const) {
      await expect(discover(changedConfig, [...changedPosts], {
        checkpoint: initial.checkpoint,
        createBlueskyReader: async () => { throw new Error("must not request history"); },
      })).rejects.toThrow(/checkpoint scope/);
    }
    const malformed = {
      ...initial.checkpoint,
      providers: {
        bluesky: { complete: false, candidates: { [target.id]: [{ blueskyUrl: "https://bsky.app/profile/me/post/abc", rawText: "private" }] } },
      },
    };
    await expect(discover({ ...config, mastodon: undefined }, [target], { checkpoint: malformed })).rejects.toThrow();
  });

  it("continues from the last successful page after a rate-limited history request", async () => {
    const target = post("2026/10/one");
    let requests = 0;
    const initial = await discover({ ...config, mastodon: undefined }, [target], {
      createBlueskyReader: async () => ({
        did: "did:plc:author",
        async getAuthorFeed() {
          if (requests++ === 0) return { feed: [blueskyPost("first", target.url)], cursor: "retry-page" };
          throw new Error("HTTP 429");
        },
      }),
    });
    expect(initial.complete).toBe(false);
    expect(initial.checkpoint.providers.bluesky?.cursor).toBe("retry-page");
    expect(initial.mappings).toEqual({});
    const resumed = await discover({ ...config, mastodon: undefined }, [target], {
      checkpoint: initial.checkpoint,
      createBlueskyReader: async () => readerForBluesky([{ feed: [] }]),
    });
    expect(resumed.complete).toBe(true);
    expect(resumed.mappings[target.id]?.blueskyUrl).toContain("tidfirst");
  });

  it("reports duplicate exact-link candidates as ambiguous", async () => {
    const target = post("2026/10/one");
    const result = await discover(config, [target], {
      createBlueskyReader: async () => readerForBluesky([{
        feed: [
          blueskyPost("first", target.url),
          blueskyPost("second", `${origin}/2026/10/one.html`),
        ],
      }]),
      createMastodonReader: async () => readerForMastodon([[]]),
    });

    expect(result.ambiguous).toEqual([{
      postId: target.id,
      provider: "bluesky",
      candidates: [
        "at://did:plc:author/app.bsky.feed.post/tidfirst",
        "at://did:plc:author/app.bsky.feed.post/tidsecond",
      ],
    }]);
    expect(result.mappings[target.id]?.blueskyUrl).toBeUndefined();
  });

  it("does not claim unmatched Mastodon posts when pagination is incomplete", async () => {
    const target = post("2026/10/one");
    const fullPage = Array.from({ length: 40 }, (_, index) => mastodonStatus(`${index + 1}`, `${origin}/unrelated/${index}`));
    const result = await discover({ ...config, bluesky: undefined }, [target], {
      maxPages: 1,
      createMastodonReader: async () => readerForMastodon([fullPage]),
    });

    expect(result.complete).toBe(false);
    expect(result.errors.mastodon).toMatch(/exceeded the 1-page scan limit/);
    expect(result.unmatched).toEqual([{
      postId: target.id,
      provider: "mastodon",
      reason: "history-incomplete",
    }]);
  });

  it("honours manual URLs without searching for replacements", async () => {
    const target = {
      ...post("2026/10/one"),
      blueskyUrl: "https://bsky.app/profile/david.gardiner.net.au/post/manual",
    };
    const result = await discover({ ...config, mastodon: undefined }, [target], {
      createBlueskyReader: async () => readerForBluesky([{ feed: [] }]),
    });

    expect(result.mappings[target.id]?.blueskyUrl).toBe(target.blueskyUrl);
    expect(result.unmatched).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it("associates Mastodon links from public statuses", async () => {
    const target = post("2026/10/one");
    const result = await discover({ ...config, bluesky: undefined }, [target], {
      createMastodonReader: async () => readerForMastodon([[
        mastodonStatus("987654", `${origin}/2026/10/one.html`),
      ]]),
    });

    expect(result.complete).toBe(true);
    expect(result.mappings[target.id]?.mastodonUrl).toBe("https://mastodon.online/@david/987654");
    expect(result.unmatched).toEqual([]);
  });

  it("ignores other authors and reposts", async () => {
    const target = post("2026/10/one");
    const someoneElse = {
      ...blueskyPost("other", target.url),
      post: { ...blueskyPost("other", target.url).post, author: { did: "did:plc:other" } },
    };
    const repost = { ...blueskyPost("repost", target.url), reason: { $type: "app.bsky.feed.defs#reasonRepost" } };
    const reply = {
      ...blueskyPost("reply", target.url),
      post: { ...blueskyPost("reply", target.url).post, record: { reply: { root: {}, parent: {} } } },
    };
    const result = await discover({ ...config, mastodon: undefined }, [target], {
      createBlueskyReader: async () => readerForBluesky([{ feed: [someoneElse, repost, reply] }]),
    });

    expect(result.mappings[target.id]).toBeUndefined();
    expect(result.unmatched).toEqual([{
      postId: target.id,
      provider: "bluesky",
      reason: "no-exact-link-match",
    }]);
  });

  it("discovers an own-authored reply containing an exact canonical blog link", async () => {
    const target = post("2026/10/one");
    const reply = blueskyPost("reply", target.url);
    reply.post.record = {
      facets: [{ features: [{ $type: "app.bsky.richtext.facet#link", uri: target.url }] }],
      reply: {
        root: { uri: "at://did:plc:someone/app.bsky.feed.post/root", cid: "root-cid" },
        parent: { uri: "at://did:plc:someone/app.bsky.feed.post/root", cid: "root-cid" },
      },
    };
    const result = await discover({ ...config, mastodon: undefined }, [target], {
      createBlueskyReader: async () => readerForBluesky([{ feed: [reply] }]),
    });
    expect(result.complete).toBe(true);
    expect(result.mappings[target.id]?.blueskyUri).toBe("at://did:plc:author/app.bsky.feed.post/tidreply");
    expect(result.ambiguous).toEqual([]);
    expect(result.unmatched).toEqual([]);
  });
});
