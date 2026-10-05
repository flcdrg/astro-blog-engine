import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import { TID } from "@atproto/common";

import { JournalPersistenceError, publishPosts, SocialPublishError } from "./publish";
import { ProviderHttpError, type BlueskyWriter, type MastodonStatus, type MastodonWriter } from "./providers";
import type { ManifestPost, Mappings, PublishingState, SocialConfig } from "../../src/scripts/social/schema";

const origin = "https://david.gardiner.net.au";
const now = DateTime.fromISO("2026-10-03T12:00:00+09:30");
const baseConfig: SocialConfig = {
  enabled: true,
  productionOrigin: origin,
  bluesky: { handle: "david.gardiner.net.au", service: "https://bsky.social" },
  mastodon: { origin: "https://mastodon.online", username: "david", maxCharacters: 500 },
  archiveReady: false,
};

function post(image?: ManifestPost["image"]): ManifestPost {
  return {
    id: "2026/10/test-post",
    source: "src/posts/2026/2026-10-03-test-post.md",
    url: `${origin}/2026/10/test-post`,
    title: "A useful post",
    description: "A useful description.",
    tags: [".NET", "testing"],
    date: now.toISO()!,
    draft: false,
    ...(image ? { image } : {}),
  };
}

function state(baseline: string[] | null = []): PublishingState {
  return { version: 1, baseline, operations: {} };
}

function createBlueskyFake(options: { throwAfterCreate?: boolean } = {}) {
  const records = new Map<string, { uri: string; value: unknown }>();
  let createCount = 0;
  const writer: BlueskyWriter = {
    did: "did:plc:author",
    async getAuthorFeed() { return { feed: [] }; },
    async getRecord(rkey) { return records.get(rkey); },
    async createPost(_post, text, rkey) {
      createCount += 1;
      const record = {
        uri: `at://did:plc:author/app.bsky.feed.post/${rkey}`,
        value: {
          text,
          facets: [{ features: [{ $type: "app.bsky.richtext.facet#link", uri: `${origin}/2026/10/test-post` }] }],
        },
      };
      records.set(rkey, record);
      if (options.throwAfterCreate) throw new Error("connection reset after remote write");
      return record;
    },
  };
  return { writer, records, get createCount() { return createCount; } };
}

function createMastodonFake(options: {
  createStatus?: (text: string, mediaId?: string) => Promise<MastodonStatus>;
  statuses?: MastodonStatus[][];
} = {}) {
  let statusPage = 0;
  const writer: MastodonWriter = {
    account: { id: "account-1", acct: "david", username: "david" },
    async getStatuses() {
      return options.statuses?.[statusPage++] ?? [];
    },
    async getInstanceLimits() {
      return {
        maxCharacters: 500,
        charactersReservedPerUrl: 23,
        imageSizeLimit: 1_000_000,
        imageMatrixLimit: 4_000_000,
      };
    },
    async uploadMedia() { return { id: "media-1" }; },
    async getMedia(id) { return { id, url: "https://mastodon.online/media/media-1.jpg" }; },
    async createStatus({ text, mediaId }) {
      if (options.createStatus) return options.createStatus(text, mediaId);
      return mastodonStatus("12345", `${origin}/2026/10/test-post`, text);
    },
  };
  return writer;
}

function mastodonStatus(id: string, link: string, text = ""): MastodonStatus {
  const content = text
    ? `<p>${text.replaceAll(link, `<a href="${link}">${link}</a>`).replaceAll("\n\n", "</p><p>")}</p>`
    : `<p>Blogged: <a href="${link}">${link}</a></p>`;
  return {
    id,
    url: `https://mastodon.online/@david/${id}`,
    content,
    created_at: now.toUTC().toISO()!,
    visibility: "public",
    account: { id: "account-1", acct: "david", username: "david" },
  };
}

function input(
  posts: ManifestPost[],
  options: {
    config?: SocialConfig;
    mappings?: Mappings;
    state?: PublishingState;
    persist?: (mappings: Mappings, state: PublishingState) => Promise<void>;
  } = {},
) {
  const persist = options.persist ?? vi.fn(async () => {});
  return {
    value: {
      config: options.config ?? baseConfig,
      posts,
      mappings: options.mappings ?? {},
      state: options.state ?? state(),
      distDir: "/tmp/dist",
      persist,
    },
    persist,
  };
}

const testOptions = {
  now,
  verifyPostIsLive: async () => {},
};

describe("publishPosts", () => {
  it("persists existing exact-link announcements without creating new posts on either provider", async () => {
    const target = post();
    const harness = input([target]);
    const bluesky = createBlueskyFake();
    bluesky.writer.getAuthorFeed = async () => ({
      feed: [{
        post: {
          uri: "at://did:plc:author/app.bsky.feed.post/existing",
          author: { did: bluesky.writer.did },
          record: {
            facets: [{ features: [{ $type: "app.bsky.richtext.facet#link", uri: target.url }] }],
          },
        },
      }],
    });
    const mastodon = createMastodonFake({ statuses: [[mastodonStatus("999", target.url)]] });
    const createStatus = vi.fn(mastodon.createStatus);
    mastodon.createStatus = createStatus;
    const result = await publishPosts(harness.value, {
      ...testOptions,
      createBlueskyWriter: async () => bluesky.writer,
      createMastodonWriter: async () => mastodon,
    });
    expect(result.published).toEqual([]);
    expect(result.skipped).toHaveLength(2);
    expect(harness.value.mappings[target.id]).toMatchObject({
      blueskyUri: "at://did:plc:author/app.bsky.feed.post/existing",
      mastodonUrl: "https://mastodon.online/@david/999",
    });
    expect(harness.persist).toHaveBeenCalledTimes(2);
    expect(bluesky.createCount).toBe(0);
    expect(createStatus).not.toHaveBeenCalled();
    expect(harness.value.state.operations).toEqual({});
  });

  it.each(["ambiguous", "incomplete"] as const)("fails a %s Bluesky preflight independently of Mastodon", async (kind) => {
    const target = post();
    const harness = input([target]);
    const bluesky = createBlueskyFake();
    bluesky.writer.getAuthorFeed = async () => {
      if (kind === "incomplete") throw new Error("history inaccessible");
      return {
        feed: ["first", "second"].map((rkey) => ({
          post: {
            uri: `at://did:plc:author/app.bsky.feed.post/${rkey}`,
            author: { did: bluesky.writer.did },
            record: {
              embed: { $type: "app.bsky.embed.external", external: { uri: target.url } },
            },
          },
        })),
      };
    };
    const mastodon = createMastodonFake();
    await expect(publishPosts(harness.value, {
      ...testOptions,
      createBlueskyWriter: async () => bluesky.writer,
      createMastodonWriter: async () => mastodon,
    })).rejects.toMatchObject({
      name: "SocialPublishError",
      result: {
        failures: [expect.objectContaining({ provider: "bluesky", message: expect.stringContaining(kind) })],
        published: [expect.objectContaining({ provider: "mastodon" })],
      },
    });
    expect(bluesky.createCount).toBe(0);
    expect(harness.value.state.operations[target.id]?.bluesky).toBeUndefined();
    expect(harness.value.state.operations[target.id]?.mastodon?.status).toBe("complete");
  });

  it("uses record recovery rather than fresh discovery for a pending Bluesky operation", async () => {
    const target = post();
    const existing = state();
    const rkey = TID.next().toString();
    existing.operations[target.id] = { bluesky: { status: "pending", rkey, startedAt: now.toISO()! } };
    const harness = input([target], { config: { ...baseConfig, mastodon: undefined }, state: existing });
    const bluesky = createBlueskyFake();
    bluesky.records.set(rkey, {
      uri: `at://did:plc:author/app.bsky.feed.post/${rkey}`,
      value: { embed: { $type: "app.bsky.embed.external", external: { uri: target.url } } },
    });
    const getAuthorFeed = vi.fn(bluesky.writer.getAuthorFeed);
    bluesky.writer.getAuthorFeed = getAuthorFeed;
    await publishPosts(harness.value, { ...testOptions, createBlueskyWriter: async () => bluesky.writer });
    expect(getAuthorFeed).not.toHaveBeenCalled();
    expect(bluesky.createCount).toBe(0);
    expect(existing.operations[target.id]?.bluesky?.status).toBe("complete");
  });

  it("recovers an attached Mastodon status before touching unavailable media or edited metadata", async () => {
    const target = { ...post({ path: "/deleted.jpg", alt: "" }), title: "An edited title" };
    const existing = state();
    existing.operations[target.id] = {
      mastodon: {
        status: "uncertain",
        startedAt: now.minus({ hours: 2 }).toISO()!,
        submittedAt: now.minus({ hours: 2 }).toISO()!,
        mediaId: "already-attached",
      },
    };
    const harness = input([target], { config: { ...baseConfig, bluesky: undefined }, state: existing });
    const writer = createMastodonFake({ statuses: [[mastodonStatus("999", target.url, "An old title")]] });
    // The historical status retains the canonical link even after its title was edited.
    writer.getStatuses = async () => [mastodonStatus("999", target.url)];
    const getMedia = vi.fn(async () => { throw new Error("media unavailable after attachment"); });
    const getInstanceLimits = vi.fn(async () => { throw new Error("instance unavailable"); });
    const prepareImage = vi.fn(async () => { throw new Error("image removed"); });
    const createStatus = vi.fn(writer.createStatus);
    writer.getMedia = getMedia;
    writer.getInstanceLimits = getInstanceLimits;
    writer.createStatus = createStatus;
    const result = await publishPosts(harness.value, {
      ...testOptions,
      createMastodonWriter: async () => writer,
      prepareImage,
    });
    expect(result.published).toEqual([expect.objectContaining({ provider: "mastodon" })]);
    expect(getMedia).not.toHaveBeenCalled();
    expect(getInstanceLimits).not.toHaveBeenCalled();
    expect(prepareImage).not.toHaveBeenCalled();
    expect(createStatus).not.toHaveBeenCalled();
    expect(existing.operations[target.id]?.mastodon?.status).toBe("complete");
  });

  it.each(["bluesky", "mastodon"] as const)("stops immediately after a %s success cannot be persisted", async (provider) => {
    const target = post();
    const harness = input([target], {
      persist: async (_mappings, savedState) => {
        if (savedState.operations[target.id]?.[provider]?.status === "complete") {
          throw new Error("durable write failed");
        }
      },
    });
    const bluesky = createBlueskyFake();
    const getRecord = vi.fn(bluesky.writer.getRecord);
    bluesky.writer.getRecord = getRecord;
    const mastodon = createMastodonFake();
    const getStatuses = vi.fn(mastodon.getStatuses);
    const createStatus = vi.fn(mastodon.createStatus);
    mastodon.getStatuses = getStatuses;
    mastodon.createStatus = createStatus;
    await expect(publishPosts(harness.value, {
      ...testOptions,
      createBlueskyWriter: async () => bluesky.writer,
      createMastodonWriter: async () => mastodon,
    })).rejects.toBeInstanceOf(JournalPersistenceError);
    expect(getRecord).not.toHaveBeenCalled();
    expect(createStatus).toHaveBeenCalledTimes(provider === "bluesky" ? 0 : 1);
    expect(getStatuses).toHaveBeenCalledTimes(provider === "bluesky" ? 0 : 1);
    expect(harness.value.state.operations[target.id]?.[provider]?.status).toBe("complete");
  });

  it("does not swallow a persistence failure after an idempotent Mastodon retry succeeds", async () => {
    const target = post();
    const existing = state();
    existing.operations[target.id] = {
      mastodon: { status: "pending", startedAt: now.toISO()!, submittedAt: now.toISO()! },
    };
    const harness = input([target], {
      config: { ...baseConfig, bluesky: undefined },
      state: existing,
      persist: async (_mappings, savedState) => {
        if (savedState.operations[target.id]?.mastodon?.status === "complete") throw new Error("write failed");
      },
    });
    const writer = createMastodonFake();
    const createStatus = vi.fn()
      .mockRejectedValueOnce(new Error("unknown submission"))
      .mockResolvedValueOnce(mastodonStatus("999", target.url));
    writer.createStatus = createStatus;
    const getStatuses = vi.fn(writer.getStatuses);
    writer.getStatuses = getStatuses;
    await expect(publishPosts(harness.value, {
      ...testOptions,
      createMastodonWriter: async () => writer,
    })).rejects.toBeInstanceOf(JournalPersistenceError);
    expect(createStatus).toHaveBeenCalledTimes(2);
    expect(getStatuses).toHaveBeenCalledTimes(2);
    expect(existing.operations[target.id]?.mastodon?.status).toBe("complete");
  });

  it("blocks publishing until an explicit baseline exists", async () => {
    const harness = input([post()], { state: state(null) });
    const createBlueskyWriter = vi.fn();

    await expect(publishPosts(harness.value, { ...testOptions, createBlueskyWriter })).rejects.toThrow(/baseline/);

    expect(createBlueskyWriter).not.toHaveBeenCalled();
    expect(harness.persist).not.toHaveBeenCalled();
  });

  it("suppresses baseline, draft, and future-dated posts", async () => {
    const alreadyLive = post();
    const draft = { ...post(), id: "2026/10/draft", draft: true };
    const future = { ...post(), id: "2026/10/future", date: now.plus({ days: 1 }).toISO()! };
    const harness = input([alreadyLive, draft, future], {
      config: { ...baseConfig, mastodon: undefined },
      state: state([alreadyLive.id]),
    });
    const createBlueskyWriter = vi.fn();
    const verifyPostIsLive = vi.fn();

    const result = await publishPosts(harness.value, {
      ...testOptions,
      createBlueskyWriter,
      verifyPostIsLive,
    });

    expect(result.published).toEqual([]);
    expect(result.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ postId: alreadyLive.id, reason: "post is part of the initial publishing baseline" }),
      expect.objectContaining({ postId: draft.id, reason: "draft posts are never published" }),
      expect.objectContaining({ postId: future.id, reason: "publication date is in the future" }),
    ]));
    expect(createBlueskyWriter).not.toHaveBeenCalled();
    expect(verifyPostIsLive).not.toHaveBeenCalled();
  });

  it("persists a valid Bluesky TID before creating a record and commits its mapping afterwards", async () => {
    const harness = input([post()], { config: { ...baseConfig, mastodon: undefined } });
    const fake = createBlueskyFake();
    let sawPendingBeforeCreate = false;
    const originalCreate = fake.writer.createPost;
    fake.writer.createPost = async (...args) => {
      const operation = harness.value.state.operations[post().id]?.bluesky;
      sawPendingBeforeCreate = operation?.status === "pending" && TID.is(operation.rkey ?? "");
      return originalCreate.call(fake.writer, ...args);
    };

    const result = await publishPosts(harness.value, {
      ...testOptions,
      createBlueskyWriter: async () => fake.writer,
    });

    expect(sawPendingBeforeCreate).toBe(true);
    expect(fake.createCount).toBe(1);
    expect(result.published).toHaveLength(1);
    expect(harness.value.mappings[post().id]?.blueskyUri).toMatch(/^at:\/\/did:plc:author\/app\.bsky\.feed\.post\//);
    expect(harness.value.state.operations[post().id]?.bluesky?.status).toBe("complete");
  });

  it("reconciles a Bluesky record created before a lost response instead of duplicating it", async () => {
    const harness = input([post()], { config: { ...baseConfig, mastodon: undefined } });
    const fake = createBlueskyFake({ throwAfterCreate: true });
    const result = await publishPosts(harness.value, {
      ...testOptions,
      createBlueskyWriter: async () => fake.writer,
    });

    expect(fake.createCount).toBe(1);
    expect(result.published).toEqual([{
      postId: post().id,
      provider: "bluesky",
      url: expect.stringContaining("/post/"),
    }]);
    expect(harness.value.state.operations[post().id]?.bluesky?.status).toBe("complete");
  });

  it("reuses the persisted media ID and required alt text for Mastodon", async () => {
    const harness = input([post({ path: "/images/photo.png", alt: "A sample image" })], {
      config: { ...baseConfig, bluesky: undefined },
    });
    const writer = createMastodonFake();
    const uploadMedia = vi.fn(async () => ({ id: "media-1" }));
    const createStatus = vi.fn(async ({ text }: { text: string }) => mastodonStatus("12345", `${origin}/2026/10/test-post`, text));
    writer.uploadMedia = uploadMedia;
    writer.createStatus = createStatus;

    const result = await publishPosts(harness.value, {
      ...testOptions,
      createMastodonWriter: async () => writer,
      prepareImage: async () => Buffer.from("jpeg"),
      mediaPollIntervalMs: 0,
    });

    const persistedMediaId = vi.mocked(harness.persist).mock.calls.some(([, savedState]) =>
      savedState.operations[post().id]?.mastodon?.mediaId === "media-1");
    expect(uploadMedia).toHaveBeenCalledWith(expect.any(Buffer), "A sample image");
    expect(persistedMediaId).toBe(true);
    expect(createStatus).toHaveBeenCalledWith(expect.objectContaining({ mediaId: "media-1" }));
    expect(result.published).toEqual([expect.objectContaining({ provider: "mastodon" })]);
  });

  it("keeps a processed media ID durable across a polling timeout and reuses it on retry", async () => {
    const target = post({ path: "/images/photo.png", alt: "A sample image" });
    const harness = input([target], { config: { ...baseConfig, bluesky: undefined } });
    const writer = createMastodonFake();
    const uploadMedia = vi.fn(async () => ({ id: "media-1" }));
    const getMedia = vi.fn(async (id: string) => ({ id }));
    const createStatus = vi.fn(async ({ text }: { text: string }) => mastodonStatus("12345", target.url, text));
    writer.uploadMedia = uploadMedia;
    writer.getMedia = getMedia;
    writer.createStatus = createStatus;
    const prepareImage = vi.fn(async () => Buffer.from("jpeg"));

    await expect(publishPosts(harness.value, {
      ...testOptions,
      createMastodonWriter: async () => writer,
      prepareImage,
      mediaPollAttempts: 1,
    })).rejects.toBeInstanceOf(SocialPublishError);
    expect(harness.value.state.operations[target.id]?.mastodon?.mediaId).toBe("media-1");
    expect(harness.value.state.operations[target.id]?.mastodon?.submittedAt).toBeUndefined();
    expect(createStatus).not.toHaveBeenCalled();

    getMedia.mockImplementation(async (id) => ({ id, url: "https://mastodon.online/media/media-1.jpg" }));
    const retry = await publishPosts(harness.value, {
      ...testOptions,
      createMastodonWriter: async () => writer,
      prepareImage,
      mediaPollAttempts: 1,
    });

    expect(retry.published).toEqual([expect.objectContaining({ provider: "mastodon" })]);
    expect(uploadMedia).toHaveBeenCalledTimes(1);
    expect(prepareImage).toHaveBeenCalledTimes(1);
    expect(createStatus).toHaveBeenCalledWith(expect.objectContaining({ mediaId: "media-1" }));
  });

  it("does not retry an unknown Mastodon submission outside the one-hour idempotency window", async () => {
    const target = post();
    const oldTime = now.minus({ hours: 2 }).toUTC().toISO()!;
    const existingState = state([]);
    existingState.operations[target.id] = {
      mastodon: { status: "pending", startedAt: oldTime, submittedAt: oldTime },
    };
    const harness = input([target], {
      config: { ...baseConfig, bluesky: undefined },
      state: existingState,
    });
    const writer = createMastodonFake();
    const createStatus = vi.fn(writer.createStatus);
    writer.createStatus = createStatus;

    await expect(publishPosts(harness.value, {
      ...testOptions,
      createMastodonWriter: async () => writer,
    })).rejects.toMatchObject({
      name: "SocialPublishError",
      result: expect.objectContaining({
        failures: [expect.objectContaining({ message: expect.stringContaining("one-hour") })],
      }),
    });

    expect(createStatus).not.toHaveBeenCalled();
    expect(harness.value.state.operations[target.id]?.mastodon?.status).toBe("uncertain");
  });

  it("reports a definite Mastodon rejection as pending rather than an unknown outcome", async () => {
    const target = post();
    const harness = input([target], { config: { ...baseConfig, bluesky: undefined } });
    const writer = createMastodonFake();
    writer.createStatus = async () => {
      throw new ProviderHttpError("Mastodon status submission", 422);
    };

    await expect(publishPosts(harness.value, {
      ...testOptions,
      createMastodonWriter: async () => writer,
    })).rejects.toMatchObject({
      name: "SocialPublishError",
      result: expect.objectContaining({
        failures: [expect.objectContaining({ message: expect.stringContaining("rejected the status") })],
      }),
    });

    const operation = harness.value.state.operations[target.id]?.mastodon;
    expect(operation?.status).toBe("pending");
    expect(operation?.submittedAt).toBeUndefined();
  });

  it("retries a Mastodon request within its idempotency window using the same key", async () => {
    const target = post();
    const submittedAt = now.minus({ minutes: 5 }).toUTC().toISO()!;
    const existingState = state([]);
    existingState.operations[target.id] = {
      mastodon: { status: "pending", startedAt: submittedAt, submittedAt },
    };
    const harness = input([target], {
      config: { ...baseConfig, bluesky: undefined },
      state: existingState,
    });
    const writer = createMastodonFake();
    const keys: string[] = [];
    let submits = 0;
    writer.createStatus = async (input) => {
      keys.push(input.idempotencyKey);
      submits += 1;
      if (submits === 1) throw new Error("response lost");
      return mastodonStatus("12345", target.url, input.text);
    };

    const result = await publishPosts(harness.value, {
      ...testOptions,
      createMastodonWriter: async () => writer,
    });

    expect(submits).toBe(2);
    expect(keys[0]).toBe(keys[1]);
    expect(result.published).toEqual([expect.objectContaining({ provider: "mastodon" })]);
    expect(harness.value.state.operations[target.id]?.mastodon?.status).toBe("complete");
  });

  it("continues with Bluesky when Mastodon fails and reports the partial result", async () => {
    const harness = input([post()]);
    const bluesky = createBlueskyFake();
    const mastodon = createMastodonFake();
    mastodon.getInstanceLimits = async () => {
      throw new Error("instance limits unavailable");
    };

    let thrown: unknown;
    try {
      await publishPosts(harness.value, {
        ...testOptions,
        createBlueskyWriter: async () => bluesky.writer,
        createMastodonWriter: async () => mastodon,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SocialPublishError);
    expect((thrown as SocialPublishError).result.published.map((item) => item.provider)).toContain("bluesky");
    expect((thrown as SocialPublishError).result.failures.map((item) => item.provider)).toContain("mastodon");
    expect(harness.value.state.operations[post().id]?.bluesky?.status).toBe("complete");
  });

  it("stops immediately if the durable journal cannot be written", async () => {
    const fake = createBlueskyFake();
    const harness = input([post()], {
      config: { ...baseConfig, mastodon: undefined },
      persist: async () => { throw new Error("read-only branch"); },
    });

    await expect(publishPosts(harness.value, {
      ...testOptions,
      createBlueskyWriter: async () => fake.writer,
    })).rejects.toBeInstanceOf(JournalPersistenceError);
    expect(fake.createCount).toBe(0);
  });
});
