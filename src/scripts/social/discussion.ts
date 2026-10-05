import { z } from "astro/zod";
import { DateTime } from "luxon";
import { parseThreadUrl, type Mapping, type Provider } from "./schema";

export const MAX_REPLIES = 20;
export const MAX_LIKE_AVATARS = 5;
export const DISCUSSION_TIMEOUT_MS = 10_000;

export interface DiscussionAuthor {
  name: string;
  profileUrl?: string | undefined;
  avatar?: string | undefined;
}

export interface DiscussionReply {
  id: string;
  parentId?: string | undefined;
  url: string;
  author: DiscussionAuthor;
  publishedAt: string;
  text?: string | undefined;
  html?: string | undefined;
  warning?: string | undefined;
}

export interface Discussion {
  rootId: string;
  likes: number | undefined;
  replyCount: number | undefined;
  reposts: number | undefined;
  replies: DiscussionReply[];
  likeAuthors: DiscussionAuthor[];
  warnings: string[];
}

export function safeDiscussionUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function discussionDate(value: string): string {
  return DateTime.fromISO(value, { zone: "Australia/Adelaide" })
    .setLocale("en-AU").toLocaleString(DateTime.DATETIME_MED);
}

const timestamp = z.string().refine((value) => DateTime.fromISO(value, { setZone: true }).isValid);
const count = z.number().int().nonnegative();
const authorSchema = z.object({
  did: z.string().regex(/^did:[^/]+$/),
  handle: z.string().min(1),
  displayName: z.string().optional(),
  avatar: z.string().optional(),
});
const blueskyPostSchema = z.object({
  uri: z.string().regex(/^at:\/\/did:[^/]+\/app\.bsky\.feed\.post\/[a-zA-Z0-9]+$/),
  author: authorSchema,
  record: z.object({
    text: z.string().max(100_000),
    createdAt: timestamp,
    reply: z.object({ parent: z.object({ uri: z.string() }) }).optional(),
  }),
  likeCount: count.optional(),
  replyCount: count.optional(),
  repostCount: count.optional(),
});
const threadNodeSchema = z.object({
  post: z.unknown().optional(),
  replies: z.array(z.unknown()).optional(),
  blocked: z.boolean().optional(),
  notFound: z.boolean().optional(),
});
const threadSchema = z.object({ thread: z.unknown() });
const likesSchema = z.object({
  likes: z.array(z.object({ actor: authorSchema })),
});
type BlueskyAuthor = z.infer<typeof authorSchema>;

function blueskyAuthor(author: BlueskyAuthor): DiscussionAuthor {
  return {
    name: author.displayName || author.handle,
    profileUrl: `https://bsky.app/profile/${encodeURIComponent(author.did)}`,
    avatar: safeDiscussionUrl(author.avatar),
  };
}

function sortedReplies(replies: DiscussionReply[]): DiscussionReply[] {
  return replies.sort((a, b) =>
    DateTime.fromISO(a.publishedAt).toMillis() - DateTime.fromISO(b.publishedAt).toMillis()
    || a.id.localeCompare(b.id)).slice(0, MAX_REPLIES);
}

export function decodeBlueskyDiscussion(threadPayload: unknown, likesPayload?: unknown): Discussion {
  const thread = threadNodeSchema.parse(threadSchema.parse(threadPayload).thread);
  if (thread.blocked || thread.notFound || !thread.post) {
    throw new Error("This Bluesky thread is unavailable or has been removed.");
  }
  const root = blueskyPostSchema.parse(thread.post);
  const replies: DiscussionReply[] = [];
  const warnings: string[] = [];
  let invalidReplies = false;
  const seen = new Set<string>([root.uri]);
  const queue: Array<{ value: unknown; parentId: string }> =
    (thread.replies ?? []).slice(0, 200).map((value) => ({ value, parentId: root.uri }));
  // A bounded traversal also protects against unexpectedly large or cyclic fixture payloads.
  for (let visited = 0; queue.length && visited < 200; visited++) {
    const entry = queue.shift()!;
    const node = threadNodeSchema.safeParse(entry.value);
    if (!node.success) { invalidReplies = true; continue; }
    if (node.data.blocked || node.data.notFound) continue;
    const parsed = blueskyPostSchema.safeParse(node.data.post);
    if (!parsed.success) { invalidReplies = true; continue; }
    if (seen.has(parsed.data.uri)) continue;
    const post = parsed.data;
    seen.add(post.uri);
    const recordId = post.uri.split("/").at(-1)!;
    replies.push({
      id: post.uri,
      parentId: post.record.reply?.parent.uri ?? entry.parentId,
      url: `https://bsky.app/profile/${encodeURIComponent(post.author.did)}/post/${recordId}`,
      author: blueskyAuthor(post.author),
      publishedAt: post.record.createdAt,
      text: post.record.text,
    });
    queue.push(...(node.data.replies ?? []).slice(0, Math.max(0, 200 - queue.length))
      .map((value) => ({ value, parentId: post.uri })));
  }
  const likes = likesSchema.safeParse(likesPayload);
  if (invalidReplies) warnings.push("Some Bluesky replies contained invalid data and could not be displayed.");
  if (likesPayload !== undefined && !likes.success) {
    warnings.push("The Bluesky likes preview contained invalid data and could not be displayed.");
  }
  return {
    rootId: root.uri,
    likes: root.likeCount,
    replyCount: root.replyCount,
    reposts: root.repostCount,
    replies: sortedReplies(replies),
    likeAuthors: likes.success
      ? likes.data.likes.slice(0, MAX_LIKE_AVATARS).map((like) => blueskyAuthor(like.actor))
      : [],
    warnings,
  };
}

const mastodonStatusSchema = z.object({
  id: z.string().regex(/^\d+$/),
  in_reply_to_id: z.string().regex(/^\d+$/).nullable(),
  visibility: z.enum(["public", "unlisted", "private", "direct"]),
  url: z.string(),
  created_at: timestamp,
  content: z.string().max(100_000),
  spoiler_text: z.string().max(10_000),
  account: z.object({
    display_name: z.string(),
    acct: z.string().min(1),
    url: z.string(),
    avatar: z.string().optional(),
  }),
  favourites_count: count.optional(),
  replies_count: count.optional(),
  reblogs_count: count.optional(),
});
const mastodonContextSchema = z.object({ descendants: z.array(z.unknown()) });

export function decodeMastodonDiscussion(statusPayload: unknown, contextPayload: unknown): Discussion {
  const root = mastodonStatusSchema.parse(statusPayload);
  if (root.visibility !== "public") throw new Error("Only public Mastodon threads can be displayed.");
  const replies: DiscussionReply[] = [];
  const warnings: string[] = [];
  let invalidReplies = false;
  const seen = new Set<string>([root.id]);
  for (const value of mastodonContextSchema.parse(contextPayload).descendants.slice(0, 200)) {
    const parsed = mastodonStatusSchema.safeParse(value);
    if (!parsed.success) { invalidReplies = true; continue; }
    const status = parsed.data;
    if (status.visibility !== "public") continue;
    const url = safeDiscussionUrl(status.url);
    if (!url) { invalidReplies = true; continue; }
    if (seen.has(status.id)) continue;
    seen.add(status.id);
    replies.push({
      id: status.id,
      parentId: status.in_reply_to_id ?? undefined,
      url,
      author: {
        name: status.account.display_name || status.account.acct,
        profileUrl: safeDiscussionUrl(status.account.url),
        avatar: safeDiscussionUrl(status.account.avatar),
      },
      publishedAt: status.created_at,
      html: status.content,
      warning: status.spoiler_text || undefined,
    });
  }
  if (invalidReplies) warnings.push("Some public Mastodon replies contained invalid data and could not be displayed.");
  return {
    rootId: root.id,
    likes: root.favourites_count,
    replyCount: root.replies_count,
    reposts: root.reblogs_count,
    replies: sortedReplies(replies),
    likeAuthors: [],
    warnings,
  };
}

type PublicFetch = (input: string, init?: RequestInit) => Promise<Response>;

async function fetchJson(url: string, signal: AbortSignal, request: PublicFetch): Promise<unknown> {
  const response = await request(url, {
    signal, credentials: "omit", referrerPolicy: "no-referrer", headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Public discussion request failed (${response.status}).`);
  return response.json();
}

export async function loadDiscussion(
  provider: Provider, mapping: Mapping, request: PublicFetch = fetch,
  timeout = DISCUSSION_TIMEOUT_MS,
): Promise<Discussion> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const get = (url: string) => fetchJson(url, controller.signal, request);
  try {
    if (provider === "mastodon") {
      const url = mapping.mastodonUrl;
      if (!url) throw new Error("Missing Mastodon thread URL.");
      const { origin, id } = parseThreadUrl(url, "mastodon");
      const status = await get(`${origin}/api/v1/statuses/${id}`);
      // Check visibility before fetching any replies.
      if (mastodonStatusSchema.parse(status).visibility !== "public") {
        throw new Error("Only public Mastodon threads can be displayed.");
      }
      const result = decodeMastodonDiscussion(status, await get(`${origin}/api/v1/statuses/${id}/context`));
      if (result.rootId !== id) throw new Error("Mastodon returned a different thread.");
      result.warnings.forEach((warning) => console.warn(`[social-discussion] ${warning}`));
      return result;
    }
    if (!mapping.blueskyUrl) throw new Error("Missing Bluesky thread URL.");
    const { actor, id } = parseThreadUrl(mapping.blueskyUrl, "bluesky");
    const api = "https://public.api.bsky.app/xrpc/";
    let uri = mapping.blueskyUri;
    if (!uri) {
      const did = actor.startsWith("did:") ? actor : z.object({
        did: z.string().regex(/^did:[^/]+$/),
      }).parse(await get(`${api}com.atproto.identity.resolveHandle?handle=${encodeURIComponent(actor)}`)).did;
      uri = `at://${did}/app.bsky.feed.post/${id}`;
    }
    if (!/^at:\/\/did:[^/]+\/app\.bsky\.feed\.post\/[a-zA-Z0-9]+$/.test(uri)) {
      throw new Error("Invalid Bluesky thread identity.");
    }
    if (!uri.endsWith(`/${id}`) || (actor.startsWith("did:") && !uri.startsWith(`at://${actor}/`))) {
      throw new Error("Bluesky URL and stored thread identity do not match.");
    }
    const encoded = encodeURIComponent(uri);
    const [thread, likes] = await Promise.all([
      get(`${api}app.bsky.feed.getPostThread?uri=${encoded}&depth=6&parentHeight=0`),
      get(`${api}app.bsky.feed.getLikes?uri=${encoded}&limit=${MAX_LIKE_AVATARS}`).catch(() => {
        const warning = "The Bluesky likes preview could not be loaded; reply data is still available.";
        console.warn(`[social-discussion] ${warning}`);
        return undefined;
      }),
    ]);
    const result = decodeBlueskyDiscussion(thread, likes);
    result.warnings.forEach((warning) => console.warn(`[social-discussion] ${warning}`));
    if (likes === undefined) result.warnings.push("The Bluesky likes preview could not be loaded; reply data is still available.");
    if (result.rootId !== uri) throw new Error("Bluesky returned a different thread.");
    return result;
  } finally {
    clearTimeout(timer);
  }
}
