import { expect, it } from "vitest";
import { mergeProgress } from "./state";
import type { PublishingState } from "../../src/scripts/social/schema";

it("merges progress per provider without dropping unmerged operations", () => {
  const complete = { status: "complete" as const, startedAt: "2026-10-01T00:00:00Z" };
  const mainState: PublishingState = { version: 1, baseline: ["2026/10/post"], operations: { "2026/10/post": { bluesky: complete } } };
  const outstanding: PublishingState = { ...mainState, operations: { "2026/10/post": { mastodon: { ...complete, status: "pending" } } } };
  const result = mergeProgress({
    mappings: { "2026/10/post": { blueskyUrl: "https://bsky.app/profile/example.com/post/abc" } }, state: mainState,
  }, {
    mappings: { "2026/10/post": { mastodonUrl: "https://mastodon.online/@name/123" } }, state: outstanding,
  });
  expect(result.state.operations["2026/10/post"]?.mastodon?.status).toBe("pending");
  expect(result.state.operations["2026/10/post"]?.bluesky?.status).toBe("complete");
  expect(result.mappings["2026/10/post"]?.mastodonUrl).toContain("/123");
  expect(result.mappings["2026/10/post"]?.blueskyUrl).toContain("/abc");
});
