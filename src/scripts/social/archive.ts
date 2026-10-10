import { z } from "astro/zod";
import { DateTime } from "luxon";
import rawArchive from "../../data/legacy-comments.json" with { type: "json" };

export const archivePostIdSchema = z.string().regex(/^\d{4}\/(?:0[1-9]|1[0-2])\/[^/?#\\]+$/)
  .refine((value) => ![".", ".."].includes(value.split("/").at(-1)!));
export const legacyCommentSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).optional(),
  name: z.string().min(1),
  html: z.string(),
  createdAt: z.string().refine((value) => DateTime.fromISO(value, { setZone: true }).isValid),
}).strict();
export const legacyArchiveSchema = z.object({
  version: z.literal(1),
  threads: z.record(archivePostIdSchema, z.array(legacyCommentSchema).min(1)),
}).strict();
export type LegacyComment = z.infer<typeof legacyCommentSchema>;
export type LegacyArchive = z.infer<typeof legacyArchiveSchema>;

export const legacyArchive = legacyArchiveSchema.parse(rawArchive);

export function legacyArchiveLink(id: string): string | undefined {
  return legacyArchive.threads[id]?.length ? `/legacy-comments/${encodeURI(id)}` : undefined;
}

export function archivePostId(urlValue: string, productionOrigin: string, knownIds: ReadonlySet<string>): string | undefined {
  try {
    const url = new URL(urlValue);
    const origin = new URL(productionOrigin);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password
      || url.host !== origin.host) return undefined;
    const id = decodeURIComponent(url.pathname.replace(/\/$/, "").replace(/\.html$/, "")).replace(/^\//, "");
    return archivePostIdSchema.safeParse(id).success && knownIds.has(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export function legacyCommentDate(value: string): string {
  return DateTime.fromISO(value, { zone: "Australia/Adelaide" })
    .setLocale("en-AU").toLocaleString(DateTime.DATETIME_MED);
}

export function orderLegacyComments(comments: LegacyComment[]): LegacyComment[] {
  return [...comments].sort((a, b) =>
    DateTime.fromISO(a.createdAt).toMillis() - DateTime.fromISO(b.createdAt).toMillis()
    || a.id.localeCompare(b.id));
}
