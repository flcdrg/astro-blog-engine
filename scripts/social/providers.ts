import { AtpAgent, RichText } from "@atproto/api";
import { TID } from "@atproto/common";
import { parse } from "node-html-parser";
import sharp from "sharp";
import { z } from "astro/zod";

import type { ManifestPost, SocialConfig } from "../../src/scripts/social/schema.ts";

const requestTimeoutMs = 15_000;
const maxReadRetries = 2;

export class ProviderHttpError extends Error {
  readonly status: number;

  constructor(operation: string, status: number, retryAfter?: string | null) {
    super(`${operation} failed with HTTP ${status}${retryAfter ? ` (Retry-After: ${retryAfter})` : ""}`);
    this.name = "ProviderHttpError";
    this.status = status;
  }
}

type FetchOptions = {
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
};

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
    if (Number.isFinite(delay) && delay >= 0) return delay;
  }
  return Math.min(500 * 2 ** attempt, 2_000);
}

export function createBoundedFetch({
  fetch: fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  timeoutMs = requestTimeoutMs,
}: FetchOptions = {}): typeof globalThis.fetch {
  return async (input, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const retryableRead = method === "GET" || method === "HEAD";

    for (let attempt = 0; ; attempt += 1) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      let response: Response;
      try {
        response = await fetchImpl(input, { ...init, signal });
      } catch (error) {
        if (retryableRead && attempt < maxReadRetries && !init.signal?.aborted) {
          await sleep(Math.min(250 * 2 ** attempt, 1_000));
          continue;
        }
        if (timeout.aborted) {
          throw new Error(`Social provider request timed out after ${timeoutMs}ms`, { cause: error });
        }
        throw error;
      }

      const retryableStatus = response.status === 429 || (retryableRead && response.status >= 500);
      if (!retryableStatus || attempt >= maxReadRetries) return response;

      const delay = retryDelay(response, attempt);
      if (delay > 5_000) return response;
      await response.body?.cancel();
      await sleep(delay);
    }
  };
}

async function readJson<T>(response: Response, operation: string): Promise<T> {
  if (!response.ok) {
    throw new ProviderHttpError(operation, response.status, response.headers.get("retry-after"));
  }
  try {
    return await response.json() as T;
  } catch (error) {
    throw new Error(`${operation} returned invalid JSON`, { cause: error });
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

export type BlueskyFeedPost = {
  post: {
    uri: string;
    author: { did: string };
    record: unknown;
    embed?: unknown;
  };
  reason?: unknown;
};

export type BlueskyFeedPage = { feed: BlueskyFeedPost[]; cursor?: string };

export type BlueskyReader = {
  did: string;
  getAuthorFeed(cursor?: string): Promise<BlueskyFeedPage>;
};

export type BlueskyRecord = { uri: string; value: unknown };

export type BlueskyWriter = BlueskyReader & {
  getRecord(rkey: string): Promise<BlueskyRecord | undefined>;
  createPost(post: ManifestPost, text: string, rkey: string): Promise<BlueskyRecord>;
};

export function parseBlueskyFeed(value: unknown): BlueskyFeedPost[] {
  if (!Array.isArray(value)) throw new Error("Bluesky author feed returned a non-array feed");
  return value.map((item, index) => {
    const wrapper = recordValue(item);
    const post = recordValue(wrapper?.post);
    const author = recordValue(post?.author);
    if (typeof post?.uri !== "string" || typeof author?.did !== "string" || !("record" in post)) {
      throw new Error(`Bluesky author feed returned a malformed post at index ${index}`);
    }
    return {
      post: {
        uri: post.uri,
        author: { did: author.did },
        record: post.record,
        ...(post.embed !== undefined ? { embed: post.embed } : {}),
      },
      ...(wrapper?.reason !== undefined ? { reason: wrapper.reason } : {}),
    };
  });
}

type BlueskyOptions = FetchOptions & { password?: string };

export async function createBlueskyReader(
  config: SocialConfig,
  options: FetchOptions = {},
): Promise<BlueskyReader> {
  if (!config.bluesky) throw new Error("Bluesky is not configured");
  const agent = new AtpAgent({
    service: "https://public.api.bsky.app",
    fetch: createBoundedFetch(options),
  });
  const resolved = await agent.resolveHandle({ handle: config.bluesky.handle });
  const did = resolved.data.did;
  return {
    did,
    async getAuthorFeed(cursor) {
      const response = await agent.app.bsky.feed.getAuthorFeed({
        actor: did,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      return {
        feed: parseBlueskyFeed(response.data.feed),
        ...(response.data.cursor ? { cursor: response.data.cursor } : {}),
      };
    },
  };
}

function isRecordNotFound(error: unknown): boolean {
  const value = recordValue(error);
  return value?.error === "RecordNotFound" || value?.status === 404;
}

export async function createBlueskyWriter(
  config: SocialConfig,
  options: BlueskyOptions = {},
): Promise<BlueskyWriter> {
  if (!config.bluesky) throw new Error("Bluesky is not configured");
  const password = options.password ?? process.env.BLUESKY_APP_PASSWORD;
  if (!password) throw new Error("BLUESKY_APP_PASSWORD is required to publish to Bluesky");

  const reader = await createBlueskyReader(config, options);
  const did = reader.did;
  const agent = new AtpAgent({
    service: config.bluesky.service,
    fetch: createBoundedFetch(options),
  });
  const session = await agent.login({ identifier: config.bluesky.handle, password });
  if (session.data.did !== did) {
    throw new Error("Bluesky credentials authenticated as a different account than the configured handle");
  }

  return {
    ...reader,
    async getRecord(rkey) {
      try {
        const response = await agent.com.atproto.repo.getRecord({
          repo: did,
          collection: "app.bsky.feed.post",
          rkey,
        });
        return { uri: response.data.uri, value: response.data.value };
      } catch (error) {
        if (isRecordNotFound(error)) return undefined;
        throw error;
      }
    },
    async createPost(post, text, rkey) {
      if (!TID.is(rkey)) throw new Error("Bluesky post record key is not a valid TID");
      const richText = new RichText({ text });
      await richText.detectFacets(agent);
      const response = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: "app.bsky.feed.post",
        rkey,
        record: {
          $type: "app.bsky.feed.post",
          text: richText.text,
          facets: richText.facets,
          createdAt: new Date().toISOString(),
        },
      });
      return {
        uri: response.data.uri,
        value: { text: richText.text, facets: richText.facets, url: post.url },
      };
    },
  };
}

export type MastodonAccount = { id: string; acct: string; username: string };

export type MastodonStatus = {
  id: string;
  url: string | null;
  content: string;
  created_at: string;
  visibility: string;
  account: { id: string; acct: string; username: string };
  reblog?: unknown;
  in_reply_to_id?: string | null | undefined;
  card?: { url?: string | null | undefined } | null | undefined;
};

export type MastodonInstanceLimits = {
  maxCharacters: number;
  charactersReservedPerUrl: number;
  imageSizeLimit?: number;
  imageMatrixLimit?: number;
};

export type MastodonReader = {
  account: MastodonAccount;
  getStatuses(maxId?: string): Promise<MastodonStatus[]>;
};

export type MastodonWriter = MastodonReader & {
  getInstanceLimits(): Promise<MastodonInstanceLimits>;
  uploadMedia(image: Buffer, alt: string): Promise<{ id: string }>;
  getMedia(id: string): Promise<{ id: string; url?: string | null }>;
  createStatus(input: {
    text: string;
    mediaId?: string;
    idempotencyKey: string;
  }): Promise<MastodonStatus>;
};

type MastodonOptions = FetchOptions & { accessToken?: string };

const mastodonAccountSchema = z.object({
  id: z.string().regex(/^\d+$/),
  acct: z.string().min(1),
  username: z.string().min(1),
});
const mastodonStatusSchema = z.object({
  id: z.string().regex(/^\d+$/),
  url: z.url().nullable(),
  content: z.string(),
  created_at: z.iso.datetime({ offset: true }),
  visibility: z.enum(["public", "unlisted", "private", "direct"]),
  account: mastodonAccountSchema,
  reblog: z.object({ id: z.string().regex(/^\d+$/) }).nullable().optional(),
  in_reply_to_id: z.string().regex(/^\d+$/).nullable().optional(),
  card: z.object({ url: z.url().nullable().optional() }).nullable().optional(),
});
const positiveLimit = z.number().int().positive();
const mastodonInstanceSchema = z.object({
  configuration: z.object({
    statuses: z.object({
      max_characters: positiveLimit,
      characters_reserved_per_url: positiveLimit,
    }),
    media_attachments: z.object({
      image_size_limit: positiveLimit,
      image_matrix_limit: positiveLimit,
    }).optional(),
  }),
});
const mastodonMediaSchema = z.object({
  id: z.string().regex(/^\d+$/),
  url: z.url().nullable().optional(),
});

function validatePayload<T>(schema: z.ZodType<T>, value: unknown, operation: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`${operation} returned a malformed provider payload`);
  return parsed.data;
}

function accountMatches(actual: string, configured: string): boolean {
  const normalise = (value: string) => value.replace(/^@/, "").toLowerCase();
  const actualName = normalise(actual);
  const expectedName = normalise(configured);
  return actualName === expectedName || actualName.split("@", 1)[0] === expectedName;
}

function mastodonUrl(origin: string, path: string): string {
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

async function requestMastodon<T>(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  token: string | undefined,
  operation: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetchImpl(url, { ...init, headers });
  return readJson<T>(response, operation);
}

export async function createMastodonReader(
  config: SocialConfig,
  options: FetchOptions = {},
): Promise<MastodonReader> {
  if (!config.mastodon) throw new Error("Mastodon is not configured");
  const fetchImpl = createBoundedFetch(options);
  const account = validatePayload(mastodonAccountSchema, await requestMastodon<unknown>(
    fetchImpl,
    mastodonUrl(config.mastodon.origin, `/api/v1/accounts/lookup?acct=${encodeURIComponent(config.mastodon.username)}`),
    undefined,
    "Mastodon account lookup",
  ), "Mastodon account lookup");
  if (!account.id || !accountMatches(account.acct || account.username, config.mastodon.username)) {
    throw new Error("Mastodon account lookup did not resolve to the configured account");
  }
  return {
    account,
    async getStatuses(maxId) {
      const url = new URL(mastodonUrl(config.mastodon!.origin, `/api/v1/accounts/${encodeURIComponent(account.id)}/statuses`));
      url.searchParams.set("limit", "40");
      url.searchParams.set("exclude_reblogs", "true");
      if (maxId) url.searchParams.set("max_id", maxId);
      const statuses = await requestMastodon<unknown>(
        fetchImpl,
        url.toString(),
        undefined,
        "Mastodon account history",
      );
      return validatePayload(z.array(mastodonStatusSchema), statuses, "Mastodon account history");
    },
  };
}

export async function createMastodonWriter(
  config: SocialConfig,
  options: MastodonOptions = {},
): Promise<MastodonWriter> {
  if (!config.mastodon) throw new Error("Mastodon is not configured");
  const accessToken = options.accessToken ?? process.env.MASTODON_ACCESS_TOKEN;
  if (!accessToken) throw new Error("MASTODON_ACCESS_TOKEN is required to publish to Mastodon");

  const reader = await createMastodonReader(config, options);
  const fetchImpl = createBoundedFetch(options);
  const verifiedAccount = validatePayload(mastodonAccountSchema, await requestMastodon<unknown>(
    fetchImpl,
    mastodonUrl(config.mastodon.origin, "/api/v1/accounts/verify_credentials"),
    accessToken,
    "Mastodon credential verification",
  ), "Mastodon credential verification");
  if (verifiedAccount.id !== reader.account.id
    || !accountMatches(verifiedAccount.acct || verifiedAccount.username, config.mastodon.username)) {
    throw new Error("Mastodon access token belongs to a different account than configured");
  }

  return {
    ...reader,
    async getInstanceLimits() {
      const data = validatePayload(mastodonInstanceSchema, await requestMastodon<unknown>(
        fetchImpl,
        mastodonUrl(config.mastodon!.origin, "/api/v2/instance"),
        undefined,
        "Mastodon instance limits",
      ), "Mastodon instance limits");
      const { max_characters: maxCharacters, characters_reserved_per_url: charactersReservedPerUrl } = data.configuration.statuses;
      const imageSizeLimit = data.configuration.media_attachments?.image_size_limit;
      const imageMatrixLimit = data.configuration.media_attachments?.image_matrix_limit;
      return {
        maxCharacters: Math.min(maxCharacters, config.mastodon!.maxCharacters),
        charactersReservedPerUrl,
        ...(typeof imageSizeLimit === "number" ? { imageSizeLimit } : {}),
        ...(typeof imageMatrixLimit === "number" ? { imageMatrixLimit } : {}),
      };
    },
    async uploadMedia(image, alt) {
      const form = new FormData();
      form.set("file", new Blob([new Uint8Array(image)], { type: "image/jpeg" }), "blog-post.jpg");
      form.set("description", alt);
      const response = await fetchImpl(
        mastodonUrl(config.mastodon!.origin, "/api/v2/media"),
        { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: form },
      );
      const media = validatePayload(mastodonMediaSchema, await readJson<unknown>(response, "Mastodon media upload"), "Mastodon media upload");
      return { id: media.id };
    },
    async getMedia(id) {
      const media = validatePayload(mastodonMediaSchema, await requestMastodon<unknown>(
        fetchImpl,
        mastodonUrl(config.mastodon!.origin, `/api/v1/media/${encodeURIComponent(id)}`),
        accessToken,
        "Mastodon media processing",
      ), "Mastodon media processing");
      if (media.id !== id) throw new Error("Mastodon media processing returned a different media ID");
      return { id, ...(media.url ? { url: media.url } : {}) };
    },
    async createStatus({ text, mediaId, idempotencyKey }) {
      const body = new URLSearchParams({
        status: text,
        visibility: "public",
        language: "en",
        ...(mediaId ? { "media_ids[]": mediaId } : {}),
      });
      const response = await fetchImpl(
        mastodonUrl(config.mastodon!.origin, "/api/v1/statuses"),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "Idempotency-Key": idempotencyKey,
          },
          body,
        },
      );
      return validatePayload(mastodonStatusSchema, await readJson<unknown>(response, "Mastodon status submission"), "Mastodon status submission");
    },
  };
}

export function extractBlueskyLinks(post: BlueskyFeedPost): string[] {
  const links = new Set<string>();
  const record = recordValue(post.post.record);
  const facets = Array.isArray(record?.facets) ? record.facets : [];
  for (const facetValue of facets) {
    const facet = recordValue(facetValue);
    const features = Array.isArray(facet?.features) ? facet.features : [];
    for (const featureValue of features) {
      const feature = recordValue(featureValue);
      if (feature?.$type === "app.bsky.richtext.facet#link" && typeof feature.uri === "string") {
        links.add(feature.uri);
      }
    }
  }

  const addExternal = (value: unknown) => {
    const embed = recordValue(value);
    if (embed?.$type === "app.bsky.embed.external") {
      const external = recordValue(embed.external);
      if (typeof external?.uri === "string") links.add(external.uri);
    }
    const media = recordValue(embed?.media);
    if (media) addExternal(media);
  };
  addExternal(record?.embed);
  addExternal(post.post.embed);
  return [...links];
}

export function extractMastodonLinks(status: MastodonStatus): string[] {
  const links = new Set<string>();
  for (const anchor of parse(status.content).querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (href) links.add(href);
  }
  if (status.card?.url) links.add(status.card.url);
  if (status.url) links.add(status.url);
  return [...links];
}

export function createBlueskyRecordKey(): string {
  return TID.next().toString();
}

export async function prepareMastodonImage(
  distDir: string,
  imagePath: string,
  limits: Pick<MastodonInstanceLimits, "imageSizeLimit" | "imageMatrixLimit">,
): Promise<Buffer> {
  if (!limits.imageSizeLimit || !limits.imageMatrixLimit) {
    throw new Error("Mastodon did not report image size and pixel limits");
  }

  const { realpath, stat } = await import("node:fs/promises");
  const { resolve, sep } = await import("node:path");
  const root = await realpath(distDir);
  const candidate = resolve(root, `.${imagePath}`);
  const resolved = await realpath(candidate);
  if (!resolved.startsWith(`${root}${sep}`)) {
    throw new Error("Image path resolves outside the deployed dist directory");
  }
  const file = await stat(resolved);
  if (!file.isFile()) throw new Error("Mastodon image path is not a file");

  const inputPixelLimit = Math.max(limits.imageMatrixLimit, 100_000_000);
  const source = sharp(resolved, { limitInputPixels: inputPixelLimit });
  const metadata = await source.metadata();
  if (!metadata.width || !metadata.height) throw new Error("Mastodon image has invalid dimensions");
  let width = Math.min(metadata.width, Math.floor(Math.sqrt(limits.imageMatrixLimit)));
  let height = Math.min(metadata.height, Math.floor(Math.sqrt(limits.imageMatrixLimit)));
  if (width * height > limits.imageMatrixLimit) {
    const scale = Math.sqrt(limits.imageMatrixLimit / (width * height));
    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const output = await sharp(resolved, { limitInputPixels: inputPixelLimit })
      .rotate()
      .resize({ width, height, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: Math.max(45, 85 - attempt * 8), mozjpeg: true })
      .toBuffer();
    if (output.byteLength <= limits.imageSizeLimit) return output;
    width = Math.max(1, Math.floor(width * 0.8));
    height = Math.max(1, Math.floor(height * 0.8));
  }
  throw new Error("Mastodon image could not be reduced within the instance upload size limit");
}

export function mastodonStatusMatchesAccount(status: MastodonStatus, account: MastodonAccount): boolean {
  return status.account?.id === account.id && !status.reblog && !status.in_reply_to_id;
}

export function isBlueskyRecordNotFound(error: unknown): boolean {
  return isRecordNotFound(error);
}
