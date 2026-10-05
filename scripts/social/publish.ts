import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { discover } from "./discover.ts";

import { formatAnnouncement, isEligible, canonicalMatch } from "../../src/scripts/social/format.ts";
import {
  createBlueskyRecordKey,
  createBlueskyWriter,
  createBoundedFetch,
  createMastodonWriter,
  prepareMastodonImage,
  extractBlueskyLinks,
  extractMastodonLinks,
  mastodonStatusMatchesAccount,
  ProviderHttpError,
  type BlueskyReader,
  type BlueskyWriter,
  type MastodonReader,
  type MastodonStatus,
  type MastodonWriter,
} from "./providers.ts";
import type {
  ManifestPost,
  Mapping,
  Mappings,
  Operation,
  Provider,
  PublishingState,
  SocialConfig,
} from "../../src/scripts/social/schema.ts";

const mastodonIdempotencyWindowMs = 60 * 60 * 1000;

export type PublishFailure = { postId: string; provider: Provider; message: string };
export type PublishResult = {
  published: Array<{ postId: string; provider: Provider; url: string }>;
  skipped: Array<{ postId: string; provider: Provider; reason: string }>;
  failures: PublishFailure[];
  warnings: Array<{ postId: string; provider: Provider; message: string }>;
};

export class SocialPublishError extends AggregateError {
  readonly result: PublishResult;

  constructor(result: PublishResult) {
    super(result.failures.map((failure) => `${failure.provider} ${failure.postId}: ${failure.message}`), "One or more social announcements failed");
    this.name = "SocialPublishError";
    this.result = result;
  }
}

export class JournalPersistenceError extends Error {
  constructor(cause: unknown) {
    super("Could not persist the social publishing journal; no further provider writes are safe", { cause });
    this.name = "JournalPersistenceError";
  }
}

export type PublishOptions = {
  now?: DateTime;
  createBlueskyWriter?: (config: SocialConfig) => Promise<BlueskyWriter>;
  createMastodonWriter?: (config: SocialConfig) => Promise<MastodonWriter>;
  verifyPostIsLive?: (url: string, origin: string) => Promise<void>;
  prepareImage?: typeof prepareMastodonImage;
  sleep?: (milliseconds: number) => Promise<void>;
  mediaPollAttempts?: number;
  mediaPollIntervalMs?: number;
};

export type PublishPostsInput = {
  config: SocialConfig;
  posts: ManifestPost[];
  mappings: Mappings;
  state: PublishingState;
  distDir: string;
  persist: (mappings: Mappings, state: PublishingState) => Promise<void>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDefinitelyRejected(error: unknown): boolean {
  const status = error instanceof ProviderHttpError
    ? error.status
    : error !== null && typeof error === "object" && "status" in error && typeof error.status === "number"
      ? error.status
      : undefined;
  return status !== undefined && status >= 400 && status < 500 && status !== 408;
}

function getOperation(state: PublishingState, postId: string, provider: Provider): Operation | undefined {
  return state.operations[postId]?.[provider];
}

function setOperation(state: PublishingState, postId: string, provider: Provider, operation: Operation): void {
  const current = state.operations[postId] ?? {};
  state.operations[postId] = { ...current, [provider]: operation };
}

function mergeMapping(mappings: Mappings, postId: string, mapping: Partial<Mapping>): void {
  mappings[postId] = { ...mappings[postId], ...mapping };
}

function restoreCompletedMapping(
  mappings: Mappings,
  postId: string,
  provider: Provider,
  operation: Operation,
): boolean {
  if (operation.status !== "complete" || !operation.url) return false;
  if (provider === "bluesky" && operation.uri) {
    mergeMapping(mappings, postId, { blueskyUrl: operation.url, blueskyUri: operation.uri });
  } else if (provider === "mastodon") {
    mergeMapping(mappings, postId, { mastodonUrl: operation.url });
  } else {
    return false;
  }
  return true;
}

function operationCompleteMapping(
  mappings: Mappings,
  postId: string,
  provider: Provider,
  operation: Operation,
): boolean {
  if (restoreCompletedMapping(mappings, postId, provider, operation)) return true;
  const mapping = mappings[postId];
  return Boolean(provider === "bluesky" ? mapping?.blueskyUrl : mapping?.mastodonUrl);
}

function postUrl(post: ManifestPost, origin: string): string {
  if (!canonicalMatch(post.url, origin)) {
    throw new Error(`Post ${post.id} does not use the configured production origin`);
  }
  return post.url;
}

async function defaultVerifyPostIsLive(url: string, origin: string): Promise<void> {
  const fetchImpl = createBoundedFetch();
  const response = await fetchImpl(url, { method: "GET" });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Production post is not live (HTTP ${response.status})`);
  if (response.url && new URL(response.url).origin !== origin) {
    throw new Error("Production post redirected away from the configured production origin");
  }
}

function blueskyRecordMatches(
  record: { uri: string; value: unknown },
  post: ManifestPost,
  did: string,
  origin: string,
  expectedRkey: string,
): boolean {
  if (record.uri !== `at://${did}/app.bsky.feed.post/${expectedRkey}`) return false;
  const view = {
    post: {
      uri: record.uri,
      author: { did },
      record: record.value,
    },
  };
  return extractBlueskyLinks(view).some((link) => canonicalMatch(link, origin) === canonicalMatch(post.url, origin));
}

function getBlueskyUrl(handle: string, rkey: string): string {
  return `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${rkey}`;
}

function getMastodonUrl(status: MastodonStatus, writer: MastodonWriter, config: SocialConfig): string {
  if (!/^\d+$/.test(status.id)) throw new Error("Mastodon returned an invalid status ID");
  const origin = config.mastodon!.origin;
  if (status.url) {
    const url = new URL(status.url);
    if (url.protocol === "https:" && url.origin === origin && !url.search && !url.hash
      && /^\/@[^/]+\/\d+$/.test(url.pathname)) return url.toString();
  }
  return `${origin}/@${encodeURIComponent(writer.account.username)}/${status.id}`;
}

function stableIdempotencyKey(postId: string): string {
  return createHash("sha256").update(`social-publisher:mastodon:${postId}`).digest("hex");
}

function hasMastodonPost(status: MastodonStatus, writer: MastodonWriter, post: ManifestPost, origin: string): boolean {
  if (status.visibility !== "public" || !mastodonStatusMatchesAccount(status, writer.account)) return false;
  const links = extractMastodonLinks(status);
  return links.some((link) => canonicalMatch(link, origin) === canonicalMatch(post.url, origin));
}

async function findMastodonSubmission(
  writer: MastodonWriter,
  post: ManifestPost,
  origin: string,
  submittedAt: string,
): Promise<MastodonStatus[]> {
  const submittedTime = Date.parse(submittedAt) - 30_000;
  const matches: MastodonStatus[] = [];
  let maxId: string | undefined;
  const seen = new Set<string>();
  for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
    const page = await writer.getStatuses(maxId);
    for (const status of page) {
      if (Date.parse(status.created_at) >= submittedTime && hasMastodonPost(status, writer, post, origin)) {
        matches.push(status);
      }
    }
    if (page.length < 40) break;
    const nextId = page.at(-1)?.id;
    if (!nextId || seen.has(nextId)) throw new Error("Mastodon timeline recovery repeated or omitted its pagination cursor");
    seen.add(nextId);
    maxId = nextId;
  }
  return matches;
}

async function markBlueskyComplete(
  input: PublishPostsInput,
  persist: () => Promise<void>,
  post: ManifestPost,
  rkey: string,
  uri: string,
): Promise<string> {
  const url = getBlueskyUrl(input.config.bluesky!.handle, rkey);
  const operation: Operation = {
    ...(getOperation(input.state, post.id, "bluesky") ?? { startedAt: new Date().toISOString() }),
    status: "complete",
    rkey,
    uri,
    url,
  };
  mergeMapping(input.mappings, post.id, { blueskyUrl: url, blueskyUri: uri });
  setOperation(input.state, post.id, "bluesky", operation);
  await persist();
  return url;
}

async function publishBlueskyPost(
  input: PublishPostsInput,
  post: ManifestPost,
  writer: BlueskyWriter,
  persist: () => Promise<void>,
  now: DateTime,
): Promise<{ url: string; warnings: string[] }> {
  const existing = getOperation(input.state, post.id, "bluesky");
  if (existing?.status === "complete") {
    if (!operationCompleteMapping(input.mappings, post.id, "bluesky", existing)) {
      throw new Error("Completed Bluesky operation has no durable mapping; manual recovery is required");
    }
    await persist();
    return { url: input.mappings[post.id]!.blueskyUrl!, warnings: [] };
  }
  const formatted = formatAnnouncement(post, "bluesky");
  let operation = existing;
  if (operation?.status === "uncertain" && !operation.rkey) {
    throw new Error("Uncertain Bluesky operation has no record key; manual recovery is required");
  }
  if (operation?.rkey) {
    const saved = await writer.getRecord(operation.rkey);
    if (saved) {
      if (!blueskyRecordMatches(saved, post, writer.did, input.config.productionOrigin, operation.rkey)) {
        throw new Error("The pending Bluesky record key contains an unrelated record; manual recovery is required");
      }
      const url = await markBlueskyComplete(input, persist, post, operation.rkey, saved.uri);
      return { url, warnings: formatted.warnings };
    }
  }

  const rkey = operation?.rkey ?? createBlueskyRecordKey();
  if (!operation?.rkey) {
    operation = { status: "pending", startedAt: now.toUTC().toISO()!, rkey };
    setOperation(input.state, post.id, "bluesky", operation);
    await persist();
  } else {
    operation = { ...operation, status: "pending" };
    setOperation(input.state, post.id, "bluesky", operation);
    await persist();
  }

  try {
    const created = await writer.createPost(post, formatted.text, rkey);
    if (!blueskyRecordMatches(created, post, writer.did, input.config.productionOrigin, rkey)) {
      throw new Error("Bluesky returned a record without the expected canonical post link");
    }
    const url = await markBlueskyComplete(input, persist, post, rkey, created.uri);
    return { url, warnings: formatted.warnings };
  } catch (error) {
    if (error instanceof JournalPersistenceError) throw error;
    const uncertain: Operation = { ...operation, status: "uncertain" };
    setOperation(input.state, post.id, "bluesky", uncertain);
    await persist();
    try {
      const saved = await writer.getRecord(rkey);
      if (saved && blueskyRecordMatches(saved, post, writer.did, input.config.productionOrigin, rkey)) {
        const url = await markBlueskyComplete(input, persist, post, rkey, saved.uri);
        return { url, warnings: formatted.warnings };
      }
    } catch (reconcileError) {
      if (reconcileError instanceof JournalPersistenceError) throw reconcileError;
      throw new Error(`Bluesky submission outcome is uncertain and record reconciliation failed: ${errorMessage(reconcileError)}`, { cause: error });
    }
    if (isDefinitelyRejected(error)) {
      setOperation(input.state, post.id, "bluesky", { ...uncertain, status: "pending" });
      await persist();
      throw new Error(`Bluesky rejected the post without creating its record: ${errorMessage(error)}`, { cause: error });
    }
    throw new Error(`Bluesky submission outcome is uncertain; retry will reconcile record ${rkey}: ${errorMessage(error)}`, { cause: error });
  }
}

async function pollMastodonMedia(
  writer: MastodonWriter,
  id: string,
  attempts: number,
  intervalMs: number,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const media = await writer.getMedia(id);
    if (media.url) return;
    if (attempt + 1 < attempts) await sleep(intervalMs);
  }
  throw new Error(`Mastodon media ${id} was not ready after ${attempts} bounded checks`);
}

async function reconcileFreshPost(
  input: PublishPostsInput,
  post: ManifestPost,
  provider: Provider,
  readers: { bluesky?: BlueskyReader; mastodon?: MastodonReader },
  persist: () => Promise<void>,
): Promise<boolean> {
  if (getOperation(input.state, post.id, provider)) return false;
  const config: SocialConfig = {
    ...input.config,
    ...(provider === "bluesky" ? { mastodon: undefined } : { bluesky: undefined }),
  };
  const discovered = await discover(config, [post], {
    ...(readers.bluesky ? { createBlueskyReader: async () => readers.bluesky! } : {}),
    ...(readers.mastodon ? { createMastodonReader: async () => readers.mastodon! } : {}),
  });
  if (!discovered.complete) {
    throw new Error(`${provider} preflight history is incomplete: ${discovered.errors[provider] ?? "full scan required"}`);
  }
  if (discovered.ambiguous.length) {
    throw new Error(`${provider} preflight found ambiguous exact-link announcements; manual association is required`);
  }
  const mapping = discovered.mappings[post.id];
  if (!mapping) return false;
  mergeMapping(input.mappings, post.id, mapping);
  await persist();
  return true;
}

async function publishMastodonPost(
  input: PublishPostsInput,
  post: ManifestPost,
  writer: MastodonWriter,
  persist: () => Promise<void>,
  options: PublishOptions,
  now: DateTime,
): Promise<{ url: string; warnings: string[] }> {
  const existing = getOperation(input.state, post.id, "mastodon");
  if (existing?.status === "complete") {
    operationCompleteMapping(input.mappings, post.id, "mastodon", existing);
    return { url: input.mappings[post.id]!.mastodonUrl!, warnings: [] };
  }
  if (existing?.submittedAt) {
    let recovered: MastodonStatus[];
    try {
      recovered = await findMastodonSubmission(writer, post, input.config.productionOrigin, existing.submittedAt);
    } catch (error) {
      if (error instanceof JournalPersistenceError) throw error;
      setOperation(input.state, post.id, "mastodon", { ...existing, status: "uncertain" });
      await persist();
      throw new Error(`Mastodon submission outcome is uncertain and account-history reconciliation failed: ${errorMessage(error)}`, { cause: error });
    }
    if (recovered.length === 1) {
      const url = getMastodonUrl(recovered[0]!, writer, input.config);
      mergeMapping(input.mappings, post.id, { mastodonUrl: url });
      setOperation(input.state, post.id, "mastodon", { ...existing, status: "complete", url });
      await persist();
      return { url, warnings: [] };
    }
    if (recovered.length > 1) {
      setOperation(input.state, post.id, "mastodon", { ...existing, status: "uncertain" });
      await persist();
      throw new Error("Multiple matching Mastodon statuses were found; manual recovery is required");
    }
    const age = now.toMillis() - Date.parse(existing.submittedAt);
    if (!Number.isFinite(age) || age < 0 || age >= mastodonIdempotencyWindowMs) {
      setOperation(input.state, post.id, "mastodon", { ...existing, status: "uncertain" });
      await persist();
      throw new Error("Mastodon submission cannot be safely retried outside its one-hour idempotency window");
    }
  }
  if (post.image && !post.image.alt.trim()) {
    throw new Error("Mastodon image has no alt text; add imageAlt before publishing");
  }
  const limits = await writer.getInstanceLimits();
  const formatted = formatAnnouncement(post, "mastodon", limits.maxCharacters, limits.charactersReservedPerUrl);
  let image: Buffer | undefined;
  if (post.image && !existing?.mediaId) {
    image = await (options.prepareImage ?? prepareMastodonImage)(input.distDir, post.image.path, limits);
  }

  let operation = existing;
  if (operation?.status === "uncertain" && !operation.submittedAt) {
    throw new Error("Uncertain Mastodon operation has no submission timestamp; manual recovery is required");
  }
  if (!operation) {
    operation = { status: "pending", startedAt: now.toUTC().toISO()! };
    setOperation(input.state, post.id, "mastodon", operation);
    await persist();
  }

  if (operation.mediaId) {
    await pollMastodonMedia(
      writer,
      operation.mediaId,
      options.mediaPollAttempts ?? 8,
      options.mediaPollIntervalMs ?? 1_000,
      options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    );
  } else if (image) {
    await persist();
    const uploaded = await writer.uploadMedia(image, post.image!.alt);
    operation = { ...operation, status: "pending", mediaId: uploaded.id };
    setOperation(input.state, post.id, "mastodon", operation);
    await persist();
    await pollMastodonMedia(
      writer,
      uploaded.id,
      options.mediaPollAttempts ?? 8,
      options.mediaPollIntervalMs ?? 1_000,
      options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    );
  }

  const submittedAt = operation.submittedAt ?? now.toUTC().toISO()!;
  operation = { ...operation, status: "pending", submittedAt };
  setOperation(input.state, post.id, "mastodon", operation);
  await persist();

  const idempotencyKey = stableIdempotencyKey(post.id);
  let submissionError: unknown;
  try {
    const status = await writer.createStatus({
      text: formatted.text,
      ...(operation.mediaId ? { mediaId: operation.mediaId } : {}),
      idempotencyKey,
    });
    if (!hasMastodonPost(status, writer, post, input.config.productionOrigin)) {
      throw new Error("Mastodon returned a status that is not public, authored by the configured account, and linked to this post");
    }
    const url = getMastodonUrl(status, writer, input.config);
    mergeMapping(input.mappings, post.id, { mastodonUrl: url });
    setOperation(input.state, post.id, "mastodon", { ...operation, status: "complete", url });
    await persist();
    return { url, warnings: formatted.warnings };
  } catch (error) {
    if (error instanceof JournalPersistenceError) throw error;
    submissionError = error;
  }

  if (isDefinitelyRejected(submissionError)) {
    const { submittedAt: _submittedAt, ...rejectedOperation } = operation;
    setOperation(input.state, post.id, "mastodon", { ...rejectedOperation, status: "pending" });
    await persist();
    throw new Error(`Mastodon rejected the status without publishing it: ${errorMessage(submissionError)}`, { cause: submissionError });
  }

  let recovered: MastodonStatus[];
  try {
    recovered = await findMastodonSubmission(writer, post, input.config.productionOrigin, submittedAt);
  } catch (reconcileError) {
    if (reconcileError instanceof JournalPersistenceError) throw reconcileError;
    setOperation(input.state, post.id, "mastodon", { ...operation, status: "uncertain" });
    await persist();
    throw new Error(`Mastodon submission outcome is uncertain and account-history reconciliation failed: ${errorMessage(reconcileError)}`, { cause: submissionError });
  }
  if (recovered.length === 1) {
    const url = getMastodonUrl(recovered[0]!, writer, input.config);
    mergeMapping(input.mappings, post.id, { mastodonUrl: url });
    setOperation(input.state, post.id, "mastodon", { ...operation, status: "complete", url });
    await persist();
    return { url, warnings: formatted.warnings };
  }
  if (recovered.length > 1) {
    setOperation(input.state, post.id, "mastodon", { ...operation, status: "uncertain" });
    await persist();
    throw new Error("Multiple matching Mastodon statuses were found; manual recovery is required");
  }

  const age = now.toMillis() - Date.parse(submittedAt);
  if (age < 0 || age >= mastodonIdempotencyWindowMs) {
    setOperation(input.state, post.id, "mastodon", { ...operation, status: "uncertain" });
    await persist();
    throw new Error("Mastodon submission cannot be safely retried outside its one-hour idempotency window");
  }

  await persist();
  try {
    const status = await writer.createStatus({
      text: formatted.text,
      ...(operation.mediaId ? { mediaId: operation.mediaId } : {}),
      idempotencyKey,
    });
    if (!hasMastodonPost(status, writer, post, input.config.productionOrigin)) {
      throw new Error("Mastodon returned a status that is not public, authored by the configured account, and linked to this post");
    }
    const url = getMastodonUrl(status, writer, input.config);
    mergeMapping(input.mappings, post.id, { mastodonUrl: url });
    setOperation(input.state, post.id, "mastodon", { ...operation, status: "complete", url });
    await persist();
    return { url, warnings: formatted.warnings };
  } catch (retryError) {
    if (retryError instanceof JournalPersistenceError) throw retryError;
    setOperation(input.state, post.id, "mastodon", { ...operation, status: "uncertain" });
    await persist();
    throw new Error(`Mastodon retry remains uncertain; manual recovery is required: ${errorMessage(retryError)}`, { cause: submissionError });
  }
}

export async function publishPosts(
  input: PublishPostsInput,
  options: PublishOptions = {},
): Promise<PublishResult> {
  const result: PublishResult = { published: [], skipped: [], failures: [], warnings: [] };
  if (!input.config.enabled) {
    for (const post of input.posts) {
      result.skipped.push({ postId: post.id, provider: "bluesky", reason: "publishing is disabled" });
      result.skipped.push({ postId: post.id, provider: "mastodon", reason: "publishing is disabled" });
    }
    return result;
  }
  if (!Array.isArray(input.state.baseline)) {
    throw new Error("Social publishing is blocked until an explicit baseline has been initialised");
  }

  const persist = async () => {
    try {
      await input.persist(input.mappings, input.state);
    } catch (error) {
      throw new JournalPersistenceError(error);
    }
  };
  const now = options.now ?? DateTime.now().setZone("Australia/Adelaide");
  const baseline = new Set(input.state.baseline);
  const eligiblePosts: ManifestPost[] = [];
  for (const post of input.posts) {
    if (post.draft) {
      for (const provider of ["bluesky", "mastodon"] as const) {
        result.skipped.push({ postId: post.id, provider, reason: "draft posts are never published" });
      }
    } else if (!isEligible(post, now)) {
      const publicationDate = DateTime.fromISO(post.date, { zone: "Australia/Adelaide" });
      const reason = publicationDate.isValid ? "publication date is in the future" : "publication date is invalid";
      for (const provider of ["bluesky", "mastodon"] as const) {
        result.skipped.push({ postId: post.id, provider, reason });
      }
    } else {
      eligiblePosts.push(post);
    }
  }
  let blueskyWriter: BlueskyWriter | undefined;
  let mastodonWriter: MastodonWriter | undefined;
  let blueskyInitialisationError: unknown;
  let mastodonInitialisationError: unknown;

  for (const post of eligiblePosts) {
    if (baseline.has(post.id)) {
      for (const provider of ["bluesky", "mastodon"] as const) {
        result.skipped.push({ postId: post.id, provider, reason: "post is part of the initial publishing baseline" });
      }
      continue;
    }

    let completedMappingRecovered = false;
    for (const provider of ["bluesky", "mastodon"] as const) {
      const operation = getOperation(input.state, post.id, provider);
      const override = provider === "bluesky" ? post.blueskyUrl : post.mastodonUrl;
      const mapped = provider === "bluesky"
        ? input.mappings[post.id]?.blueskyUrl
        : input.mappings[post.id]?.mastodonUrl;
      if (operation?.status === "complete" && !override && !mapped) {
        if (!restoreCompletedMapping(input.mappings, post.id, provider, operation)) {
          throw new Error(`Completed ${provider} operation for ${post.id} has no recoverable mapping`);
        }
        completedMappingRecovered = true;
      }
    }
    if (completedMappingRecovered) await persist();

    const providerNeedsWork = (provider: Provider) => {
      const override = provider === "bluesky" ? post.blueskyUrl : post.mastodonUrl;
      const mapped = provider === "bluesky"
        ? input.mappings[post.id]?.blueskyUrl
        : input.mappings[post.id]?.mastodonUrl;
      const op = getOperation(input.state, post.id, provider);
      return !override && !mapped && op?.status !== "complete";
    };
    const needsBluesky = Boolean(input.config.bluesky && providerNeedsWork("bluesky"));
    const needsMastodon = Boolean(input.config.mastodon && providerNeedsWork("mastodon"));
    if (!needsBluesky && !needsMastodon) {
      for (const provider of ["bluesky", "mastodon"] as const) {
        result.skipped.push({ postId: post.id, provider, reason: "already mapped, overridden, or complete" });
      }
      continue;
    }

    let liveCheckError: unknown;
    try {
      const url = postUrl(post, input.config.productionOrigin);
      await (options.verifyPostIsLive ?? defaultVerifyPostIsLive)(url, input.config.productionOrigin);
    } catch (error) {
      liveCheckError = error;
    }

    if (needsBluesky) {
      try {
        if (liveCheckError) throw liveCheckError;
        if (!blueskyWriter) {
          if (blueskyInitialisationError) throw blueskyInitialisationError;
          try {
            blueskyWriter = await (options.createBlueskyWriter ?? createBlueskyWriter)(input.config);
          } catch (error) {
            blueskyInitialisationError = error;
            throw error;
          }
        }
        if (await reconcileFreshPost(input, post, "bluesky", { bluesky: blueskyWriter }, persist)) {
          result.skipped.push({ postId: post.id, provider: "bluesky", reason: "reconciled an existing exact-link announcement" });
        } else {
          const published = await publishBlueskyPost(input, post, blueskyWriter, persist, now);
          result.published.push({ postId: post.id, provider: "bluesky", url: published.url });
          result.warnings.push(...published.warnings.map((message) => ({ postId: post.id, provider: "bluesky" as const, message })));
        }
      } catch (error) {
        if (error instanceof JournalPersistenceError) throw error;
        result.failures.push({ postId: post.id, provider: "bluesky", message: errorMessage(error) });
      }
    }

    if (needsMastodon) {
      try {
        if (liveCheckError) throw liveCheckError;
        if (!mastodonWriter) {
          if (mastodonInitialisationError) throw mastodonInitialisationError;
          try {
            mastodonWriter = await (options.createMastodonWriter ?? createMastodonWriter)(input.config);
          } catch (error) {
            mastodonInitialisationError = error;
            throw error;
          }
        }
        if (await reconcileFreshPost(input, post, "mastodon", { mastodon: mastodonWriter }, persist)) {
          result.skipped.push({ postId: post.id, provider: "mastodon", reason: "reconciled an existing exact-link announcement" });
        } else {
          const published = await publishMastodonPost(input, post, mastodonWriter, persist, options, now);
          result.published.push({ postId: post.id, provider: "mastodon", url: published.url });
          result.warnings.push(...published.warnings.map((message) => ({ postId: post.id, provider: "mastodon" as const, message })));
        }
      } catch (error) {
        if (error instanceof JournalPersistenceError) throw error;
        result.failures.push({ postId: post.id, provider: "mastodon", message: errorMessage(error) });
      }
    }
  }

  if (result.failures.length) throw new SocialPublishError(result);
  return result;
}
