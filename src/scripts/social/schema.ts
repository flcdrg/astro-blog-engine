import { z } from "astro/zod";

export const providerSchema = z.enum(["bluesky", "mastodon"]);
export type Provider = z.infer<typeof providerSchema>;

export function parseThreadUrl(value: string, provider: Provider) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error(`Invalid ${provider} thread URL`);
  }
  const match = provider === "bluesky"
    ? url.hostname === "bsky.app" && url.pathname.match(/^\/profile\/([^/]+)\/post\/([a-zA-Z0-9]+)$/)
    : url.pathname.match(/^\/@([^/]+)\/(\d+)$/);
  if (!match) throw new Error(`Invalid ${provider} thread URL`);
  return { origin: url.origin, actor: match[1]!, id: match[2]! };
}

export const threadUrlSchema = (provider: Provider) => z.string().refine((url) => {
  try { parseThreadUrl(url, provider); return true; } catch { return false; }
}, `Invalid ${provider} thread URL`);

export const configSchema = z.object({
  enabled: z.boolean(),
  previewHostSuffix: z.string().regex(/^[a-z0-9.-]+\.workers\.dev$/).optional(),
  productionOrigin: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  }),
  bluesky: z.object({
    handle: z.string().min(1),
    service: z.url().refine((value) => {
      const url = new URL(value);
      return url.protocol === "https:" && url.origin === value;
    }),
  }).optional(),
  mastodon: z.object({
    origin: z.url().refine((value) => new URL(value).protocol === "https:" && new URL(value).origin === value),
    username: z.string().min(1),
    maxCharacters: z.number().int().positive(),
  }).optional(),
  archiveReady: z.boolean(),
});
export type SocialConfig = z.infer<typeof configSchema>;

export const mappingSchema = z.object({
  blueskyUrl: threadUrlSchema("bluesky").optional(),
  blueskyUri: z.string().regex(/^at:\/\/did:[^/]+\/app\.bsky\.feed\.post\/[a-zA-Z0-9]+$/).optional(),
  mastodonUrl: threadUrlSchema("mastodon").optional(),
}).strict();
export const mappingsSchema = z.record(z.string(), mappingSchema);
export type Mapping = z.infer<typeof mappingSchema>;
export type Mappings = z.infer<typeof mappingsSchema>;

export const manifestPostSchema = z.object({
  id: z.string().regex(/^\d{4}\/\d{2}\/[^/]+$/),
  source: z.string().regex(/^src\/posts\/.*\.mdx?$/),
  url: z.url().max(2048),
  title: z.string().min(1).max(1000),
  description: z.string().max(10000),
  tags: z.array(z.string().max(200)).max(50),
  date: z.iso.datetime({ offset: true }),
  draft: z.boolean(),
  image: z.object({ path: z.string().startsWith("/"), alt: z.string() }).optional(),
  blueskyUrl: threadUrlSchema("bluesky").optional(),
  mastodonUrl: threadUrlSchema("mastodon").optional(),
}).strict();
export type ManifestPost = z.infer<typeof manifestPostSchema>;
export const manifestSchema = z.object({
  version: z.literal(1),
  origin: z.url(),
  posts: z.array(manifestPostSchema),
}).strict();
export type Manifest = z.infer<typeof manifestSchema>;

export const operationSchema = z.object({
  status: z.enum(["pending", "complete", "uncertain"]),
  startedAt: z.iso.datetime({ offset: true }),
  rkey: z.string().optional(),
  mediaId: z.string().optional(),
  submittedAt: z.iso.datetime({ offset: true }).optional(),
  url: z.string().optional(),
  uri: z.string().optional(),
}).strict();
export type Operation = z.infer<typeof operationSchema>;
export const stateSchema = z.object({
  version: z.literal(1),
  baseline: z.array(z.string()).nullable(),
  operations: z.record(z.string(), z.partialRecord(providerSchema, operationSchema)),
}).strict();
export type PublishingState = z.infer<typeof stateSchema>;
