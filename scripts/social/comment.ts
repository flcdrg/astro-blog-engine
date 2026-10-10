import { readFile } from "node:fs/promises";
import { loadSocialConfig } from "../../src/scripts/social/load-config.ts";
import { previewSchema, renderPreview } from "./preview.ts";
import { gh } from "./github.ts";
import { z } from "astro/zod";

const repo = process.env.GITHUB_REPOSITORY ?? "";
const number = process.env.PR_NUMBER ?? "";
const head = process.env.PR_HEAD_SHA ?? "";
if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^\d+$/.test(number)) throw new Error("Invalid PR identity");
const pr = gh<{ head: { sha: string }; state: string }>(`repos/${repo}/pulls/${number}`);
if (pr.state !== "open" || pr.head.sha !== head) throw new Error("Preview run is stale or PR is closed");
const content = await readFile("social-preview-artifact/social-preview.json", "utf8");
if (Buffer.byteLength(content) > 1_000_000) throw new Error("Preview artifact too large");
const preview = previewSchema.parse(JSON.parse(content));
if (preview.head !== head) throw new Error("Preview artifact SHA mismatch");
const config = loadSocialConfig();
const deployment = z.object({ head: z.string(), origin: z.url() }).strict().parse(
  JSON.parse(await readFile("social-preview-deployment/deployment.json", "utf8")),
);
if (deployment.head !== head) throw new Error("Deployment artifact SHA mismatch");
const body = renderPreview(preview, config, deployment.origin);
const comments: Array<{ id: number; body: string; user: { login: string } }> = [];
for (let page = 1; ; page++) {
  const batch = gh<typeof comments>(`repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`);
  comments.push(...batch);
  if (batch.length < 100) break;
}
const previous = comments.find((comment) => comment.user.login === "github-actions[bot]" && comment.body.startsWith("<!-- social-announcement-preview -->"));
gh(previous ? `repos/${repo}/issues/comments/${previous.id}` : `repos/${repo}/issues/${number}/comments`, previous ? "PATCH" : "POST", { body });
