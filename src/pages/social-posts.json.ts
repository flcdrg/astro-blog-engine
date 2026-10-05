import { getCollection } from "astro:content";
import { getImage } from "astro:assets";
import { socialConfig } from "../scripts/social/config";
import { manifestSchema, type ManifestPost } from "../scripts/social/schema";
import { getCanonicalUrl } from "../scripts/canonical";
import { DateTime } from "luxon";

export async function GET() {
  const posts: ManifestPost[] = [];
  for (const post of await getCollection("blog")) {
    if (!import.meta.env.DEV && (post.data.draft || DateTime.fromISO(post.data.date, { zone: "Australia/Adelaide" }) > DateTime.now())) continue;
    if (!post.filePath) throw new Error(`Missing source path for ${post.id}`);
    const image = post.data.image
      ? await getImage({ src: post.data.image, format: "jpeg" })
      : undefined;
    posts.push({
      id: post.id,
      source: post.filePath.replace(/\\/g, "/").replace(/^.*?(?=src\/posts\/)/, ""),
      url: String(getCanonicalUrl(new URL(encodeURI(`/${post.id}`), socialConfig.productionOrigin), new URL(socialConfig.productionOrigin))),
      title: post.data.title,
      description: post.data.description ?? "",
      tags: post.data.tags,
      date: post.data.date,
      draft: post.data.draft,
      ...(image ? { image: { path: image.src, alt: post.data.imageAlt ?? "" } } : {}),
      ...(post.data.blueskyUrl ? { blueskyUrl: post.data.blueskyUrl } : {}),
      ...(post.data.mastodonUrl ? { mastodonUrl: post.data.mastodonUrl } : {}),
    });
  }
  return new Response(JSON.stringify(manifestSchema.parse({
    version: 1, origin: socialConfig.productionOrigin, posts: posts.sort((a, b) => a.id.localeCompare(b.id)),
  })), { headers: { "Content-Type": "application/json" } });
}
