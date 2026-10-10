import { DateTime } from "luxon";
import type { ManifestPost, Provider } from "./schema";

const segmenter = new Intl.Segmenter("en-AU", { granularity: "grapheme" });
export const graphemes = (text: string) => [...segmenter.segment(text)].map((part) => part.segment);

export function normaliseHashtag(tag: string): string {
  if (/^\.net$/i.test(tag)) return "dotnet";
  return graphemes(tag.replace(/[^\p{L}\p{N}_]/gu, "")).slice(0, 64).join("");
}

export function isEligible(post: ManifestPost, now: DateTime = DateTime.now()) {
  return !post.draft && DateTime.fromISO(post.date, { zone: "Australia/Adelaide" }) <= now;
}

export function canonicalMatch(value: string, origin: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.origin !== origin || url.search || url.hash) return undefined;
    return origin + (url.pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/");
  } catch { return undefined; }
}

export function formatAnnouncement(post: ManifestPost, provider: Provider, maxCharacters = 500, reservedUrlLength = 23) {
  if (!post.description.trim()) throw new Error(`Post ${post.id} needs a description before preparing an announcement`);
  const limit = provider === "bluesky" ? 300 : maxCharacters;
  let title = graphemes(post.title.replace(/\s+/g, " ").trim());
  let description = graphemes(post.description.replace(/\s+/g, " ").trim());
  const tags = [...new Set(post.tags.filter((tag) => tag !== "others").map(normaliseHashtag).filter(Boolean))];
  const warnings: string[] = [];
  const text = () => [`Blogged: ${title.join("")}`, description.join(""), post.url, tags.map((tag) => `#${tag}`).join(" ")].filter(Boolean).join("\n\n");
  const length = (value: string) => provider === "mastodon"
    ? graphemes(value).length + [...value.matchAll(/https?:\/\/[^\s]+/gi)].reduce((total, [url]) => total + reservedUrlLength - graphemes(url).length, 0)
    : graphemes(value).length;
  const tooLong = () => length(text()) > limit || (provider === "bluesky" && new TextEncoder().encode(text()).length > 3000);
  const originalDescription = description.length;
  if (tooLong()) {
    const original = description;
    let low = 0;
    let high = original.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      description = original.slice(0, middle);
      if (tooLong()) high = middle - 1;
      else low = middle;
    }
    description = original.slice(0, low);
  }
  if (description.length < originalDescription) warnings.push("Description shortened to fit the platform limit.");
  const originalTags = tags.length;
  while (tooLong() && tags.length) tags.pop();
  if (tags.length < originalTags) warnings.push("Some hashtags omitted to fit the platform limit.");
  const originalTitle = title.length;
  if (tooLong() && title.length > 15) {
    const original = title;
    let low = 15;
    let high = original.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      title = original.slice(0, middle);
      if (tooLong()) high = middle - 1;
      else low = middle;
    }
    title = original.slice(0, low);
  }
  if (title.length < originalTitle) warnings.push("Title shortened to fit the platform limit.");
  if (tooLong()) throw new Error(`Cannot fit announcement for ${post.id} without losing its URL or meaningful title`);
  return { text: text(), length: length(text()), limit, warnings };
}
