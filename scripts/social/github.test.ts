import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Journal } from "./github";
import type { PublishingState } from "../../src/scripts/social/schema";

const mocks = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync: mocks.exec }));
const sha = "a".repeat(40);
const state: PublishingState = { version: 1, baseline: ["2026/10/post"], operations: {} };
let calls: Array<{ args: string[]; input?: Record<string, unknown> }>;
let nonMapping: boolean;
let existing: boolean;

beforeEach(() => {
  calls = [];
  nonMapping = false;
  existing = false;
  mocks.exec.mockImplementation((_file: string, args: string[], options: { input?: string }) => {
    const input = options.input ? JSON.parse(options.input) as Record<string, unknown> : undefined;
    calls.push({ args, ...(input ? { input } : {}) });
    if (args[0] !== "api") return "";
    const path = args[1]!;
    if (path.includes("matching-refs")) return "[]";
    if (path.includes("/git/ref/heads/main")) return JSON.stringify({ object: { sha } });
    if (path.includes("/git/commits/")) return JSON.stringify({ tree: { sha: "tree" } });
    if (path.endsWith("/git/trees")) return JSON.stringify({ sha: "newtree" });
    if (path.endsWith("/git/commits")) return JSON.stringify({ sha: "newcommit" });
    if (path.includes("/compare/")) return JSON.stringify({ files: [{ filename: nonMapping ? "README.md" : "src/data/social-posts.json" }] });
    if (path.includes("/pulls?")) return JSON.stringify(existing ? [{ number: 1, draft: false, body: "", user: { login: "bot" } }] : []);
    if (path.endsWith("/pulls")) return JSON.stringify({ number: 1, draft: false, body: input?.body, user: { login: "bot" } });
    if (path.includes("/rules/branches/")) return JSON.stringify([{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "build" }] } }]);
    if (path.includes("/contents/")) return JSON.stringify({ content: Buffer.from("{}").toString("base64") });
    if (path === "graphql") return JSON.stringify({ data: { viewer: { login: "bot" } } });
    if (path === "repos/owner/repo") return JSON.stringify({ allow_auto_merge: true });
    return "{}";
  });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("durable mapping journal", () => {
  it("persists only mappings/state atomically and avoids duplicate commits", async () => {
    const journal = new Journal("owner/repo", sha);
    journal.load();
    await journal.persist({}, state);
    await journal.persist({}, state);
    const trees = calls.filter((call) => call.args[1]?.endsWith("/git/trees"));
    expect(trees).toHaveLength(1);
    expect(trees[0]?.input?.tree).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "src/data/social-posts.json" }),
      expect.objectContaining({ path: "src/data/social-publishing-state.json" }),
    ]));
  });
  it("does not auto-merge historical mapping PRs", async () => {
    vi.stubEnv("SOCIAL_AUTO_MERGE", "true");
    const journal = new Journal("owner/repo", sha);
    await journal.persist({}, state, true);
    journal.openPullRequest(state, true);
    expect(calls.some((call) => call.args.includes("--auto"))).toBe(false);
    expect(calls.find((call) => call.args[1]?.endsWith("/pulls"))?.input?.body).toContain("social-manual-review");
  });
  it("suspends auto-merge before persisting pending progress", async () => {
    existing = true;
    const pending: PublishingState = { ...state, operations: { "2026/10/post": { mastodon: { status: "pending", startedAt: "2026-10-01T00:00:00Z" } } } };
    const journal = new Journal("owner/repo", sha);
    await journal.persist({}, pending);
    const hold = calls.findIndex((call) => call.args.includes("--disable-auto"));
    const tree = calls.findIndex((call) => call.args[1]?.endsWith("/git/trees"));
    expect(hold).toBeGreaterThanOrEqual(0);
    expect(hold).toBeLessThan(tree);
  });
  it("rejects PRs changing code even when auto-merge is requested", async () => {
    nonMapping = true;
    vi.stubEnv("SOCIAL_AUTO_MERGE", "true");
    const journal = new Journal("owner/repo", sha);
    await journal.persist({}, state);
    expect(() => journal.openPullRequest(state)).toThrow("non-mapping");
    expect(calls.some((call) => call.args.includes("--auto"))).toBe(false);
  });
  it("enables auto-merge only for completed allowlisted changes with required checks", async () => {
    vi.stubEnv("SOCIAL_AUTO_MERGE", "true");
    const journal = new Journal("owner/repo", sha);
    await journal.persist({}, state);
    journal.openPullRequest(state);
    expect(calls.some((call) => call.args.includes("--auto"))).toBe(true);
  });
});
