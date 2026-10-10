import { createHash } from "node:crypto";
import { z } from "astro/zod";
import { canonicalMatch } from "../../src/scripts/social/format.ts";
import {
  mappingSchema,
  parseThreadUrl,
  type ManifestPost,
  type Mapping,
  type Mappings,
  type Provider,
  type SocialConfig,
} from "../../src/scripts/social/schema.ts";
import {
  createBlueskyReader,
  createMastodonReader,
  extractBlueskyLinks,
  extractMastodonLinks,
  mastodonStatusMatchesAccount,
  type BlueskyFeedPost,
  type BlueskyReader,
  type MastodonReader,
  type MastodonStatus,
} from "./providers.ts";

const historyPageLimit = 1_000;
const blueskyCandidateSchema = mappingSchema.refine(
  (value) => Boolean(value.blueskyUrl && value.blueskyUri && !value.mastodonUrl),
  "Bluesky checkpoint candidates require only a Bluesky URL and URI",
);
const mastodonCandidateSchema = mappingSchema.refine(
  (value) => Boolean(value.mastodonUrl && !value.blueskyUrl && !value.blueskyUri),
  "Mastodon checkpoint candidates require only a Mastodon URL",
);
const providerCheckpoint = (candidate: typeof blueskyCandidateSchema) => z.object({
  complete: z.boolean(),
  cursor: z.string().min(1).optional(),
  candidates: z.record(z.string(), z.array(candidate)),
}).strict().refine((value) => !value.complete || !value.cursor, "Completed history must not have a cursor");

export const discoveryCheckpointSchema = z.object({
  version: z.literal(1),
  scope: z.string().regex(/^[a-f0-9]{64}$/),
  providers: z.object({
    bluesky: providerCheckpoint(blueskyCandidateSchema).optional(),
    mastodon: providerCheckpoint(mastodonCandidateSchema).optional(),
  }).strict(),
}).strict();
export type DiscoveryCheckpoint = z.infer<typeof discoveryCheckpointSchema>;
type ProviderCheckpoint = NonNullable<DiscoveryCheckpoint["providers"]["bluesky"]>;

export type DiscoveryAmbiguity = { postId: string; provider: Provider; candidates: string[] };
export type DiscoveryUnmatched = {
  postId: string;
  provider: Provider;
  reason: "no-exact-link-match" | "history-incomplete";
};
export type DiscoveryResult = {
  mappings: Mappings;
  ambiguous: DiscoveryAmbiguity[];
  unmatched: DiscoveryUnmatched[];
  complete: boolean;
  restartRequired: boolean;
  errors: Partial<Record<Provider, string>>;
  resume: { blueskyCursor?: string; mastodonMaxId?: string };
  checkpoint: DiscoveryCheckpoint;
};
export type DiscoveryOptions = {
  maxPages?: number;
  mappings?: Mappings;
  checkpoint?: unknown;
  resume?: { blueskyCursor?: string; mastodonMaxId?: string };
  createBlueskyReader?: (config: SocialConfig) => Promise<BlueskyReader>;
  createMastodonReader?: (config: SocialConfig) => Promise<MastodonReader>;
};

function canonicalIndex(posts: ManifestPost[], origin: string): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const post of posts) {
    const url = canonicalMatch(post.url, origin);
    if (!url) throw new Error(`Post ${post.id} does not have a canonical URL on ${origin}`);
    if ([...index.values()].some((ids) => ids.includes(post.id))) throw new Error(`Duplicate post ID ${post.id}`);
    index.set(url, [...(index.get(url) ?? []), post.id]);
  }
  return index;
}

function scopeFingerprint(config: SocialConfig, posts: ManifestPost[]): string {
  const catalogue = posts.map((post) => [post.id, canonicalMatch(post.url, config.productionOrigin)])
    .sort(([left], [right]) => left!.localeCompare(right!));
  return createHash("sha256").update(JSON.stringify({
    origin: config.productionOrigin,
    bluesky: config.bluesky ? { handle: config.bluesky.handle, service: config.bluesky.service } : null,
    mastodon: config.mastodon ? { origin: config.mastodon.origin, username: config.mastodon.username } : null,
    catalogue,
  })).digest("hex");
}

function candidateIdentity(mapping: Mapping, provider: Provider): string {
  if (provider === "bluesky") return mapping.blueskyUri!;
  const thread = parseThreadUrl(mapping.mastodonUrl!, "mastodon");
  return `${thread.origin}/${thread.id}`;
}

function addCandidates(
  progress: ProviderCheckpoint,
  provider: Provider,
  links: string[],
  mapping: Mapping,
  index: Map<string, string[]>,
  origin: string,
): void {
  for (const link of links) {
    const url = canonicalMatch(link, origin);
    if (!url) continue;
    for (const id of index.get(url) ?? []) {
      const candidates = progress.candidates[id] ?? [];
      if (!candidates.some((saved) => candidateIdentity(saved, provider) === candidateIdentity(mapping, provider))) {
        progress.candidates[id] = [...candidates, mapping];
      }
    }
  }
}

function blueskyMapping(item: BlueskyFeedPost, did: string, handle: string): Mapping {
  const prefix = `at://${did}/app.bsky.feed.post/`;
  if (!item.post.uri.startsWith(prefix)) throw new Error("Bluesky feed returned an unrelated repository URI");
  const rkey = item.post.uri.slice(prefix.length);
  if (!/^[a-zA-Z0-9]+$/.test(rkey)) throw new Error("Bluesky feed returned an invalid record key");
  return { blueskyUri: item.post.uri, blueskyUrl: `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${rkey}` };
}

function mastodonMapping(status: MastodonStatus, config: SocialConfig): Mapping {
  if (!/^\d+$/.test(status.id)) throw new Error("Mastodon feed returned an invalid status ID");
  return {
    mastodonUrl: `${config.mastodon!.origin}/@${encodeURIComponent(status.account.username)}/${status.id}`,
  };
}

function validateCheckpoint(checkpoint: DiscoveryCheckpoint, config: SocialConfig, posts: ManifestPost[]): void {
  if (checkpoint.scope !== scopeFingerprint(config, posts)) {
    throw new Error("Discovery checkpoint scope does not match configured accounts, origin and canonical post catalogue");
  }
  const ids = new Set(posts.map((post) => post.id));
  for (const provider of ["bluesky", "mastodon"] as const) {
    const progress = checkpoint.providers[provider];
    if (Boolean(progress) !== Boolean(config[provider])) throw new Error("Discovery checkpoint providers do not match configuration");
    if (provider === "mastodon" && progress?.cursor && !/^\d+$/.test(progress.cursor)) {
      throw new Error("Checkpoint Mastodon cursor must be a string status ID");
    }
    for (const [id, candidates] of Object.entries(progress?.candidates ?? {})) {
      if (!ids.has(id)) throw new Error(`Checkpoint contains an unknown post ID: ${id}`);
      for (const mapping of candidates) {
        if (provider === "bluesky") {
          const parsed = parseThreadUrl(mapping.blueskyUrl!, "bluesky");
          const uri = mapping.blueskyUri!;
          const did = uri.split("/")[2]!;
          if (uri !== `at://${did}/app.bsky.feed.post/${parsed.id}`
            || (parsed.actor !== config.bluesky!.handle && parsed.actor !== did)) {
            throw new Error("Checkpoint Bluesky URL and URI identities disagree");
          }
        } else {
          const parsed = parseThreadUrl(mapping.mastodonUrl!, "mastodon");
          if (parsed.origin !== config.mastodon!.origin
            || parsed.actor.toLowerCase() !== config.mastodon!.username.replace(/^@/, "").toLowerCase()) {
            throw new Error("Checkpoint Mastodon candidate belongs to another instance or account");
          }
        }
      }
      progress!.candidates[id] = [...new Map(candidates.map((mapping) => [candidateIdentity(mapping, provider), mapping])).values()];
    }
  }
}

async function scanBluesky(
  reader: BlueskyReader, progress: ProviderCheckpoint, config: SocialConfig,
  index: Map<string, string[]>, maxPages: number,
): Promise<void> {
  for (const candidates of Object.values(progress.candidates)) {
    if (candidates.some((mapping) => !mapping.blueskyUri!.startsWith(`at://${reader.did}/`))) {
      throw new Error("Checkpoint Bluesky candidates no longer belong to the configured handle's resolved account");
    }
  }
  const cursors = new Set(progress.cursor ? [progress.cursor] : []);
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await reader.getAuthorFeed(progress.cursor);
    for (const item of page.feed) {
      if (item.post.author.did !== reader.did || item.reason) continue;
      addCandidates(progress, "bluesky", extractBlueskyLinks(item), blueskyMapping(item, reader.did, config.bluesky!.handle), index, config.productionOrigin);
    }
    if (!page.cursor) {
      progress.complete = true;
      delete progress.cursor;
      return;
    }
    if (cursors.has(page.cursor)) throw new Error("Bluesky feed repeated a pagination cursor; checkpoint cannot advance");
    cursors.add(page.cursor);
    progress.cursor = page.cursor;
  }
  throw new Error(`Bluesky history exceeded the ${maxPages}-page scan limit; continue with the checkpoint`);
}

async function scanMastodon(
  reader: MastodonReader, progress: ProviderCheckpoint, config: SocialConfig,
  index: Map<string, string[]>, maxPages: number,
): Promise<void> {
  const cursors = new Set(progress.cursor ? [progress.cursor] : []);
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = await reader.getStatuses(progress.cursor);
    for (const status of page) {
      if (status.visibility !== "public" || !mastodonStatusMatchesAccount(status, reader.account)) continue;
      addCandidates(progress, "mastodon", extractMastodonLinks(status), mastodonMapping(status, config), index, config.productionOrigin);
    }
    if (page.length < 40) {
      progress.complete = true;
      delete progress.cursor;
      return;
    }
    const cursor = page.at(-1)?.id;
    if (!cursor || cursors.has(cursor)) throw new Error("Mastodon history repeated or omitted its pagination cursor");
    cursors.add(cursor);
    progress.cursor = cursor;
  }
  throw new Error(`Mastodon history exceeded the ${maxPages}-page scan limit; continue with the checkpoint`);
}

export async function discover(config: SocialConfig, posts: ManifestPost[], options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
  if (options.resume !== undefined) {
    throw new Error("Cursor-only discovery resume is unsafe without accumulated candidates; restart a full history scan or supply a checkpoint");
  }
  const maxPages = options.maxPages ?? historyPageLimit;
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error("Discovery maxPages must be a positive integer");
  const index = canonicalIndex(posts, config.productionOrigin);
  const checkpoint = options.checkpoint !== undefined ? discoveryCheckpointSchema.parse(options.checkpoint) : {
    version: 1 as const,
    scope: scopeFingerprint(config, posts),
    providers: {
      ...(config.bluesky ? { bluesky: { complete: false, candidates: {} } } : {}),
      ...(config.mastodon ? { mastodon: { complete: false, candidates: {} } } : {}),
    },
  } satisfies DiscoveryCheckpoint;
  validateCheckpoint(checkpoint, config, posts);
  const mappings: Mappings = Object.fromEntries(Object.entries(options.mappings ?? {}).map(([id, mapping]) => [id, { ...mapping }]));
  const ambiguous: DiscoveryAmbiguity[] = [];
  const unmatched: DiscoveryUnmatched[] = [];
  const errors: DiscoveryResult["errors"] = {};
  for (const provider of ["bluesky", "mastodon"] as const) {
    const progress = checkpoint.providers[provider];
    if (!progress) continue;
    if (!progress.complete) {
      try {
        if (provider === "bluesky") {
          const reader = await (options.createBlueskyReader ?? createBlueskyReader)(config);
          await scanBluesky(reader, progress, config, index, maxPages);
        } else {
          const reader = await (options.createMastodonReader ?? createMastodonReader)(config);
          await scanMastodon(reader, progress, config, index, maxPages);
        }
      } catch (error) {
        errors[provider] = error instanceof Error ? error.message : String(error);
      }
    }
    for (const post of posts) {
      const override = provider === "bluesky" ? post.blueskyUrl : post.mastodonUrl;
      if (override) {
        const current = mappings[post.id] ?? {};
        mappings[post.id] = provider === "bluesky"
          ? { ...current, blueskyUrl: override, ...(current.blueskyUrl !== override ? { blueskyUri: undefined } : {}) }
          : { ...current, mastodonUrl: override };
        continue;
      }
      if (provider === "bluesky" ? mappings[post.id]?.blueskyUrl : mappings[post.id]?.mastodonUrl) continue;
      if (!progress.complete) {
        unmatched.push({ postId: post.id, provider, reason: "history-incomplete" });
        continue;
      }
      const sameUrl = index.get(canonicalMatch(post.url, config.productionOrigin)!)!;
      const candidates = progress.candidates[post.id] ?? [];
      const unique = [...new Map(candidates.map((mapping) => [candidateIdentity(mapping, provider), mapping])).values()];
      if (sameUrl.length > 1 || unique.length > 1) {
        ambiguous.push({
          postId: post.id, provider,
          candidates: sameUrl.length > 1 ? sameUrl : unique.map((mapping) =>
            (provider === "bluesky" ? mapping.blueskyUri : mapping.mastodonUrl)!),
        });
      } else if (unique.length === 1) {
        mappings[post.id] = { ...mappings[post.id], ...unique[0] };
      } else {
        unmatched.push({ postId: post.id, provider, reason: "no-exact-link-match" });
      }
    }
  }
  const complete = Object.values(checkpoint.providers).every((progress) => progress !== undefined && progress.complete);
  return {
    mappings, ambiguous, unmatched, complete, restartRequired: false, errors, checkpoint,
    resume: {
      ...(checkpoint.providers.bluesky?.cursor ? { blueskyCursor: checkpoint.providers.bluesky.cursor } : {}),
      ...(checkpoint.providers.mastodon?.cursor ? { mastodonMaxId: checkpoint.providers.mastodon.cursor } : {}),
    },
  };
}
