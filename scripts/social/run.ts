import { appendFile, readFile, writeFile } from "node:fs/promises";
import { manifestSchema, mappingsSchema, stateSchema } from "../../src/scripts/social/schema.ts";
import { loadSocialConfig } from "../../src/scripts/social/load-config.ts";
import { isEligible } from "../../src/scripts/social/format.ts";
import { Journal } from "./github.ts";
import { discover, discoveryCheckpointSchema } from "./discover.ts";
import { publishPosts, SocialPublishError, type PublishResult } from "./publish.ts";
import { mergeProgress } from "./state.ts";

const mode = process.argv[2] ?? "dry-run";
if (!["dry-run", "backfill", "initialise", "publish"].includes(mode)) throw new Error("Use dry-run, backfill, initialise or publish");
if (mode === "publish" && process.env.SOCIAL_DISCOVERY_CHECKPOINT) throw new Error("Discovery checkpoints are only for dry-run, backfill or initialise");
const config = loadSocialConfig();
const manifest = manifestSchema.parse(JSON.parse(await readFile("dist/social-posts.json", "utf8")));
if (manifest.origin !== config.productionOrigin) throw new Error("Manifest origin does not match production");
for (const post of manifest.posts) {
  if (new URL(post.url).origin !== config.productionOrigin) throw new Error("Post is not on the production origin");
}
let mappings = mappingsSchema.parse(JSON.parse(await readFile("src/data/social-posts.json", "utf8")));
let state = stateSchema.parse(JSON.parse(await readFile("src/data/social-publishing-state.json", "utf8")));
const reviewedBaseline = state.baseline !== null;
const writeMode = mode !== "dry-run";
if (writeMode && (!config.enabled || process.env.GITHUB_REF !== "refs/heads/main" || process.env.SOCIAL_DEPLOYED !== "true")) {
  throw new Error("Writes require opt-in, main branch and successful production deployment");
}
const journal = writeMode ? new Journal(process.env.GITHUB_REPOSITORY ?? "", process.env.GITHUB_SHA ?? "") : undefined;
const outstanding = journal?.load();
if (outstanding) {
  ({ mappings, state } = mergeProgress({ mappings, state }, outstanding));
}
if (mode !== "publish") {
  const checkpoint = process.env.SOCIAL_DISCOVERY_CHECKPOINT
    ? discoveryCheckpointSchema.parse(JSON.parse(await readFile(process.env.SOCIAL_DISCOVERY_CHECKPOINT, "utf8")))
    : undefined;
  const result = await discover(config, manifest.posts, { mappings, ...(checkpoint ? { checkpoint } : {}) });
  await writeFile("social-backfill-report.json", JSON.stringify(result, null, 2) + "\n");
  await writeFile("social-discovery-checkpoint.json", JSON.stringify(result.checkpoint, null, 2) + "\n");
  if (!result.complete) throw new Error("History scan incomplete; see social-backfill-report.json");
  if (writeMode) {
    for (const [id, mapping] of Object.entries(result.mappings)) mappings[id] = { ...mapping, ...mappings[id] };
    if (mode === "initialise") {
      if (state.baseline !== null) throw new Error("Baseline already initialised");
      state.baseline = manifest.posts.filter((post) => isEligible(post)).map((post) => post.id);
    }
    await journal!.persist(mappings, state, true);
    // Historical changes always require review.
    process.env.SOCIAL_AUTO_MERGE = "false";
    journal!.openPullRequest(state, true);
  }
} else {
  if (!reviewedBaseline) throw new Error("Merge the reviewed historical baseline into main before publishing");
  const liveResponse = await fetch(`${config.productionOrigin}/social-posts.json`, {
    signal: AbortSignal.timeout(20000), cache: "no-store", redirect: "error",
  });
  if (!liveResponse.ok) throw new Error(`Production manifest is unavailable (${liveResponse.status})`);
  const liveManifest = manifestSchema.parse(await liveResponse.json());
  if (JSON.stringify(liveManifest) !== JSON.stringify(manifest)) throw new Error("Production manifest does not match this deployment; retry after it is live");
  let publicationError: unknown;
  let result: PublishResult | undefined;
  try {
    result = await publishPosts({
      config, posts: manifest.posts, mappings, state, distDir: "dist",
      persist: async (nextMappings, nextState) => journal!.persist(nextMappings, nextState),
    });
  } catch (error) {
    publicationError = error;
    if (error instanceof SocialPublishError) result = error.result;
  }
  if (result) {
    await writeFile("social-publishing-report.json", JSON.stringify(result, null, 2) + "\n");
    for (const warning of result.warnings) console.warn(`${warning.provider} ${warning.postId}: ${warning.message}`);
    for (const failure of result.failures) console.error(`${failure.provider} ${failure.postId}: ${failure.message}`);
    console.log(`Social announcements: ${result.published.length} associated, ${result.failures.length} failed.`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY,
        `## Social announcements\n\n${result.published.length} associated; ${result.failures.length} failed; ${result.warnings.length} formatting warnings. See the social-publishing-report artifact for details.\n`);
    }
  }
  try {
    journal!.openPullRequest(state);
  } catch (error) {
    if (publicationError) throw new AggregateError([publicationError, error], "Publishing and mapping PR creation failed");
    throw error;
  }
  if (publicationError) throw publicationError;
}
