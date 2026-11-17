import { readFile } from "node:fs/promises";
import { beforeEach, expect, it, vi } from "vitest";
import { commentPreview } from "./comment";
import { gh } from "./github";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  readFile: vi.fn(),
}));
vi.mock("./github", () => ({ gh: vi.fn() }));
vi.mock("../../src/scripts/social/load-config", () => ({
  loadSocialConfig: () => ({ enabled: false, archiveReady: false, productionOrigin: "https://example.com" }),
}));

const head = "a".repeat(40);
const otherHead = "b".repeat(40);
const repo = "example/blog";
const pull = `repos/${repo}/pulls/123`;
const comments = `repos/${repo}/issues/123/comments`;

beforeEach(() => {
  vi.resetAllMocks();
});

it.each([
  { reason: "closed pull request", state: "closed", sha: head },
  { reason: "changed pull request head", state: "open", sha: otherHead },
])("skips a preview for a $reason without reading artifacts or commenting", async ({ state, sha }) => {
  vi.mocked(gh).mockReturnValue({ state, head: { sha } });
  await expect(commentPreview(repo, "123", head)).resolves.toBeUndefined();
  expect(gh).toHaveBeenCalledOnce();
  expect(gh).toHaveBeenCalledWith(pull);
  expect(readFile).not.toHaveBeenCalled();
});

it("posts a preview for an open pull request with matching artifacts", async () => {
  vi.mocked(gh).mockReturnValueOnce({ state: "open", head: { sha: head } }).mockReturnValueOnce([]).mockReturnValueOnce({});
  vi.mocked(readFile)
    .mockResolvedValueOnce(JSON.stringify({ version: 1, head, posts: [] }) as never)
    .mockResolvedValueOnce(JSON.stringify({ head, origin: "https://example.com" }) as never);
  await commentPreview(repo, "123", head);
  expect(gh).toHaveBeenLastCalledWith(comments, "POST", {
    body: expect.stringContaining("No new blog posts in this pull request."),
  });
});

it.each([
  { artifact: "preview", previewHead: otherHead, deploymentHead: head, message: "Preview artifact SHA mismatch" },
  { artifact: "deployment", previewHead: head, deploymentHead: otherHead, message: "Deployment artifact SHA mismatch" },
])("rejects a mismatched $artifact artifact without commenting", async ({ previewHead, deploymentHead, message }) => {
  vi.mocked(gh).mockReturnValue({ state: "open", head: { sha: head } });
  vi.mocked(readFile)
    .mockResolvedValueOnce(JSON.stringify({ version: 1, head: previewHead, posts: [] }) as never)
    .mockResolvedValueOnce(JSON.stringify({ head: deploymentHead, origin: "https://example.com" }) as never);
  await expect(commentPreview(repo, "123", head)).rejects.toThrow(message);
  expect(gh).toHaveBeenCalledOnce();
});
