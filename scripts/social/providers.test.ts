import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TID } from "@atproto/common";

import {
  createBlueskyRecordKey,
  createBlueskyReader,
  createBlueskyWriter,
  createMastodonReader,
  createMastodonWriter,
  createBoundedFetch,
  extractBlueskyLinks,
  extractMastodonLinks,
  parseBlueskyFeed,
  prepareMastodonImage,
  type BlueskyFeedPost,
  type MastodonStatus,
} from "./providers";
import type { SocialConfig } from "../../src/scripts/social/schema.ts";

const blueskyConfig: SocialConfig = {
  enabled: true,
  productionOrigin: "https://example.com",
  archiveReady: false,
  bluesky: { handle: "author.example.com", service: "https://pds.example.com" },
};
const mastodonConfig: SocialConfig = {
  enabled: true, archiveReady: false, productionOrigin: "https://example.com",
  mastodon: { origin: "https://mastodon.example", username: "author", maxCharacters: 500 },
};
const validAccount = { id: "123", acct: "author", username: "author" };

describe("social provider helpers", () => {
  it.each([{}, { id: 123, acct: "author", username: "author" }, { id: "123", acct: "", username: "author" }])(
    "rejects malformed Mastodon account data",
    async (payload) => {
      await expect(createMastodonReader(mastodonConfig, {
        fetch: async () => Response.json(payload),
      })).rejects.toThrow(/malformed provider payload/);
    },
  );

  it("rejects malformed history entries rather than treating them as absent or nonpublic", async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      return Response.json(url.includes("lookup") ? validAccount : [{ id: "999", visibility: "broken" }]);
    };
    const reader = await createMastodonReader(mastodonConfig, { fetch });
    await expect(reader.getStatuses()).rejects.toThrow(/account history returned a malformed/);
  });

  it.each([0, -1, 1.5, null])("rejects invalid Mastodon instance limits (%s)", async (limit) => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      return Response.json(url.includes("/instance") ? {
        configuration: { statuses: { max_characters: limit, characters_reserved_per_url: 23 } },
      } : validAccount);
    };
    const writer = await createMastodonWriter(mastodonConfig, { fetch, accessToken: "mock-token" });
    await expect(writer.getInstanceLimits()).rejects.toThrow(/instance limits returned a malformed/);
  });

  it("validates a submitted Mastodon status before confirming publishing success", async () => {
    const fetch: typeof globalThis.fetch = async (_input, init) =>
      Response.json(init?.method === "POST" ? { id: "999", visibility: "public" } : validAccount);
    const writer = await createMastodonWriter(mastodonConfig, { fetch, accessToken: "mock-token" });
    await expect(writer.createStatus({ text: "A post", idempotencyKey: "key" })).rejects.toThrow(/status submission returned a malformed/);
  });

  it("uses the public AppView for unauthenticated handle resolution and author-feed reads", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.origin).toBe("https://public.api.bsky.app");
      if (url.pathname.endsWith("resolveHandle")) return Response.json({ did: "did:plc:author" });
      expect(url.pathname).toBe("/xrpc/app.bsky.feed.getAuthorFeed");
      expect(url.searchParams.get("actor")).toBe("did:plc:author");
      expect(url.searchParams.get("cursor")).toBe("next-page");
      return Response.json({ feed: [] });
    });
    const reader = await createBlueskyReader(blueskyConfig, { fetch });
    expect(await reader.getAuthorFeed("next-page")).toEqual({ feed: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps login and repo operations on the configured PDS while writer history reads use the public AppView", async () => {
    const requests: URL[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url);
      if (url.pathname.endsWith("resolveHandle")) return Response.json({ did: "did:plc:author" });
      if (url.pathname.endsWith("createSession")) {
        return Response.json({
          did: "did:plc:author", handle: "author.example.com",
          accessJwt: "test-access-token", refreshJwt: "test-refresh-token", active: true,
        });
      }
      if (url.pathname.endsWith("getRecord")) {
        return Response.json({ error: "RecordNotFound", message: "No record" }, { status: 400 });
      }
      return Response.json({ feed: [] });
    });
    const writer = await createBlueskyWriter(blueskyConfig, { fetch, password: "mock-app-password" });
    await writer.getAuthorFeed();
    expect(await writer.getRecord("existing")).toBeUndefined();
    expect(requests.map((url) => [url.origin, url.pathname])).toEqual([
      ["https://public.api.bsky.app", "/xrpc/com.atproto.identity.resolveHandle"],
      ["https://pds.example.com", "/xrpc/com.atproto.server.createSession"],
      ["https://public.api.bsky.app", "/xrpc/app.bsky.feed.getAuthorFeed"],
      ["https://pds.example.com", "/xrpc/com.atproto.repo.getRecord"],
    ]);
  });

  it("validates and retains the Bluesky feed view post wrapper", () => {
    const item = {
      post: {
        uri: "at://did:plc:author/app.bsky.feed.post/key",
        author: { did: "did:plc:author" },
        record: { text: "A post" },
      },
      reason: { $type: "app.bsky.feed.defs#reasonRepost" },
    };
    expect(parseBlueskyFeed([item])).toEqual([item]);
    expect(() => parseBlueskyFeed([{ post: { uri: "no-author" } }])).toThrow(/malformed post/);
    expect(() => parseBlueskyFeed({ feed: [] })).toThrow(/non-array feed/);
  });

  it("creates Bluesky record keys using valid TIDs", () => {
    expect(TID.is(createBlueskyRecordKey())).toBe(true);
  });

  it("discovers Bluesky links from facets and nested external embeds", () => {
    const post: BlueskyFeedPost = {
      post: {
        uri: "at://did:plc:author/app.bsky.feed.post/key",
        author: { did: "did:plc:author" },
        record: {
          facets: [{
            features: [
              { $type: "app.bsky.richtext.facet#link", uri: "https://example.com/facet" },
            ],
          }],
        },
        embed: {
          $type: "app.bsky.embed.recordWithMedia",
          media: {
            $type: "app.bsky.embed.external",
            external: { uri: "https://example.com/embed" },
          },
        },
      },
    };

    expect(extractBlueskyLinks(post)).toEqual([
      "https://example.com/facet",
      "https://example.com/embed",
    ]);
  });

  it("extracts Mastodon anchor, card, and status links", () => {
    const status: MastodonStatus = {
      id: "123",
      url: "https://mastodon.example/@user/123",
      content: '<p><a href="https://example.com/post">link</a></p>',
      created_at: "2026-10-03T00:00:00.000Z",
      visibility: "public",
      account: { id: "user", acct: "user", username: "user" },
      card: { url: "https://example.com/card" },
    };

    expect(extractMastodonLinks(status)).toEqual([
      "https://example.com/post",
      "https://example.com/card",
      "https://mastodon.example/@user/123",
    ]);
  });

  it("retries bounded rate-limited reads using Retry-After", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const sleep = vi.fn(async () => {});
    const boundedFetch = createBoundedFetch({ fetch, sleep });

    const response = await boundedFetch("https://example.com/public", { method: "GET" });

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(0);
  });

  it("defers rather than retrying before a long Retry-After has elapsed", async () => {
    const limited = new Response("defer", { status: 429, headers: { "Retry-After": "60" } });
    const fetch = vi.fn(async () => limited);
    const sleep = vi.fn(async () => {});
    const response = await createBoundedFetch({ fetch, sleep })("https://example.com/public");
    expect(response).toBe(limited);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(response.bodyUsed).toBe(false);
  });

  it("refuses image paths that resolve outside dist", async () => {
    const parent = await mkdtemp(join(tmpdir(), "social-image-"));
    try {
      const dist = join(parent, "dist");
      await mkdir(dist);
      await writeFile(join(parent, "outside.jpg"), "not an image");

      await expect(prepareMastodonImage(dist, "/../outside.jpg", {
        imageSizeLimit: 10_000,
        imageMatrixLimit: 10_000,
      })).rejects.toThrow(/outside the deployed dist directory/);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
