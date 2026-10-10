import { XMLParser } from "fast-xml-parser";
import { SyntaxValidator } from "fast-xml-validator";
import sanitizeHtml from "sanitize-html";
import { z } from "astro/zod";
import { DateTime } from "luxon";
import { archivePostId, legacyArchiveSchema, orderLegacyComments, type LegacyArchive, type LegacyComment } from "./archive.ts";

export function sanitiseLegacyHtml(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: ["p", "br", "a", "strong", "em", "b", "i", "code", "pre", "blockquote", "ul", "ol", "li"],
    allowedAttributes: { a: ["href", "title", "rel", "target"] },
    allowedSchemes: ["http", "https"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attributes) => {
        let href: string | undefined;
        try {
          const url = new URL(attributes["href"] ?? "");
          if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) href = url.href;
        } catch { /* Invalid links are rendered as text. */ }
        return {
          tagName: "a",
          attribs: {
            ...(href ? { href } : {}),
            ...(attributes["title"] ? { title: attributes["title"] } : {}),
            rel: "nofollow noopener noreferrer",
            target: "_blank",
          },
        };
      },
    },
  });
}

const reference = z.object({ "@_id": z.string().min(1) });
const threadSchema = reference.extend({ link: z.string().min(1), isDeleted: z.string().optional() });
const postSchema = reference.extend({
  thread: reference,
  parent: reference.optional(),
  message: z.string(),
  createdAt: z.string(),
  author: z.object({ name: z.string().optional() }),
  isDeleted: z.string(),
  isSpam: z.string(),
  isApproved: z.string().optional(),
  status: z.string().optional(),
});
const values = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value];

export interface DisqusImportResult {
  archive: LegacyArchive;
  unmatchedThreads: string[];
  skippedPosts: number;
  importedComments: number;
  unknownApprovalPosts: number;
}

export function importDisqusXml(
  xml: string, productionOrigin: string, knownIds: ReadonlySet<string>,
  approvedIds: ReadonlySet<string> = new Set(),
): DisqusImportResult {
  if (/<!DOCTYPE/i.test(xml)) throw new Error("Disqus exports must not contain a document type declaration.");
  try {
    SyntaxValidator.validate(xml);
  } catch {
    throw new Error("Invalid Disqus XML.");
  }
  const parsed: unknown = new XMLParser({
    ignoreAttributes: false, removeNSPrefix: true,
    parseTagValue: false, parseAttributeValue: false, trimValues: false,
  }).parse(xml);
  const document = z.object({ disqus: z.object({
    thread: z.unknown().optional(), post: z.unknown().optional(),
  }) }).parse(parsed).disqus;
  const threads = new Map<string, string>();
  const unmatchedThreads: string[] = [];
  for (const value of values(document.thread)) {
    const result = threadSchema.safeParse(value);
    if (!result.success) {
      const identity = reference.safeParse(value);
      if (identity.success) unmatchedThreads.push(identity.data["@_id"]);
      continue;
    }
    if (result.data.isDeleted?.trim() === "true") continue;
    const thread = result.data;
    const id = archivePostId(thread.link.trim(), productionOrigin, knownIds);
    if (id) {
      if (threads.has(thread["@_id"]) && threads.get(thread["@_id"]) !== id) {
        throw new Error("Conflicting Disqus thread identity.");
      }
      threads.set(thread["@_id"], id);
    }
    else unmatchedThreads.push(thread["@_id"]);
  }
  const collected: Record<string, LegacyComment[]> = {};
  let skippedPosts = 0;
  let unknownApprovalPosts = 0;
  for (const value of values(document.post)) {
    const result = postSchema.safeParse(value);
    if (!result.success) { skippedPosts++; continue; }
    const post = result.data;
    // Standard WXR may lack approval flags. Absence is not evidence of public approval.
    if (post.isDeleted.trim() !== "false" || post.isSpam.trim() !== "false"
      || (post.isApproved !== undefined && post.isApproved.trim() !== "true")
      || (post.status !== undefined && post.status.trim() !== "approved")) {
      skippedPosts++;
      continue;
    }
    if (post.isApproved?.trim() !== "true" && post.status?.trim() !== "approved"
      && !approvedIds.has(post["@_id"])) {
      unknownApprovalPosts++;
      skippedPosts++;
      continue;
    }
    const id = threads.get(post.thread["@_id"]);
    const date = DateTime.fromISO(post.createdAt.trim(), { zone: "utc" });
    if (!id || !date.isValid) { skippedPosts++; continue; }
    const html = sanitiseLegacyHtml(post.message);
    if (!sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim()) {
      skippedPosts++;
      continue;
    }
    const comments = collected[id] ?? (collected[id] = []);
    if (comments.some((comment) => comment.id === post["@_id"])) {
      throw new Error("Duplicate Disqus comment identity.");
    }
    comments.push({
      id: post["@_id"],
      ...(post.parent ? { parentId: post.parent["@_id"] } : {}),
      name: post.author.name?.trim() || "Anonymous",
      html,
      createdAt: date.toUTC().toISO()!,
    });
  }
  const output: LegacyArchive = { version: 1, threads: {} };
  for (const [id, comments] of Object.entries(collected).sort(([a], [b]) => a.localeCompare(b))) {
    const byId = new Map(comments.map((comment) => [comment.id, comment]));
    for (const comment of comments) {
      if (!comment.parentId) continue;
      const seen = new Set<string>([comment.id]);
      let parent: string | undefined = comment.parentId;
      while (parent) {
        if (!byId.has(parent) || seen.has(parent)) {
          delete comment.parentId;
          break;
        }
        seen.add(parent);
        parent = byId.get(parent)?.parentId;
      }
    }
    output.threads[id] = orderLegacyComments(comments);
  }
  const archive = legacyArchiveSchema.parse(output);
  return {
    archive,
    unmatchedThreads: [...new Set(unmatchedThreads)].sort(),
    skippedPosts,
    importedComments: Object.values(archive.threads).reduce((total, comments) => total + comments.length, 0),
    unknownApprovalPosts,
  };
}
