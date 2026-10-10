import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { z } from "astro/zod";
import { DateTime } from "luxon";
import { manifestSchema, manifestPostSchema, type SocialConfig } from "../../src/scripts/social/schema.ts";
import { loadSocialConfig } from "../../src/scripts/social/load-config.ts";
import { formatAnnouncement, isEligible } from "../../src/scripts/social/format.ts";

export const previewSchema = z.object({
  version: z.literal(1),
  head: z.string().regex(/^[a-f0-9]{40}$/),
  posts: z.array(manifestPostSchema).max(100),
}).strict();
export type Preview = z.infer<typeof previewSchema>;
const clean = (value: string) => value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/@/g, "@\u200b");
const block = (value: string) => {
  const text = clean(value);
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${text}\n${fence}`;
};

export function renderPreview(preview: Preview, config: SocialConfig, deploymentOrigin?: string) {
  let imageOrigin: string | undefined;
  if (deploymentOrigin && config.previewHostSuffix) {
    const origin = new URL(deploymentOrigin);
    if (origin.protocol !== "https:" || origin.origin !== deploymentOrigin || origin.username || origin.password ||
      !(origin.hostname === config.previewHostSuffix || origin.hostname.endsWith(`.${config.previewHostSuffix}`))) {
      throw new Error("Preview image deployment is not on the configured host suffix");
    }
    imageOrigin = origin.origin;
  }
  const sections = [
    "<!-- social-announcement-preview -->",
    "## Social announcement previews",
    "Examples only: nothing has been posted or uploaded. Production limits will be checked again before publishing.",
  ];
  if (!preview.posts.length) sections.push("No new blog posts in this pull request.");
  for (const post of preview.posts) {
    if (new URL(post.url).origin !== config.productionOrigin) throw new Error("Preview URL must use the production origin");
    sections.push(`### Post ${sections.filter((s) => s.startsWith("### Post")).length + 1}`, block(post.title));
    const date = DateTime.fromISO(post.date, { zone: "Australia/Adelaide", locale: "en-AU" }).toLocaleString(DateTime.DATETIME_FULL);
    sections.push(block(`${post.draft ? "Draft: will not publish" : isEligible(post) ? "Ready after production deployment" : "Scheduled"}\nPublication: ${date}`));
    for (const provider of ["bluesky", "mastodon"] as const) {
      if (!config[provider]) continue;
      const formatted = formatAnnouncement(post, provider, config.mastodon?.maxCharacters);
      sections.push(`**${provider === "bluesky" ? "Bluesky" : "Mastodon"}** (${formatted.length}/${formatted.limit})`, block(formatted.text));
      if (formatted.warnings.length) sections.push(block(formatted.warnings.join("\n")));
    }
    if (post.image && config.mastodon) {
      sections.push("**Planned Mastodon attachment**", block(`File: ${post.image.path}\nAlt text: ${post.image.alt || "(missing: must be added before publishing)"}`));
      if (imageOrigin && /^\/_astro\/[a-zA-Z0-9._-]+$/.test(post.image.path)) {
        sections.push(`![Planned Mastodon attachment](${new URL(post.image.path, imageOrigin).href})`);
      }
    }
  }
  const body = sections.join("\n\n");
  if (body.length > 60000) throw new Error("Announcement preview exceeds GitHub comment size; split the content PR");
  return body;
}

export async function generatePreview(base: string, head: string) {
  if (!/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(head)) throw new Error("Expected commit SHAs");
  const manifest = manifestSchema.parse(JSON.parse(await readFile("dist/social-posts.json", "utf8")));
  const added = new Set(execFileSync("git", ["diff", "--name-only", "--diff-filter=A", "-z", `${base}...${head}`, "--", "src/posts"], { encoding: "utf8" }).split("\0"));
  const preview = previewSchema.parse({ version: 1, head, posts: manifest.posts.filter((post) => added.has(post.source)) });
  const config = loadSocialConfig();
  // Render now as well so formatting failures are visible in the PR build.
  renderPreview(preview, config);
  await writeFile("social-preview.json", JSON.stringify(preview, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await generatePreview(process.env.PR_BASE_SHA ?? "", process.env.PR_HEAD_SHA ?? "");
}
