import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { previewSchema } from "./preview";

it("previews every added post but not edits to existing posts using the real CLI", async () => {
  const directory = await mkdtemp(join(tmpdir(), "social-preview-"));
  const git = (...args: string[]) => execFileSync("git", [
    "-c", "core.hooksPath=/dev/null",
    "-c", "user.name=Copilot",
    "-c", "user.email=223556219+Copilot@users.noreply.github.com",
    ...args,
  ], { cwd: directory, encoding: "utf8" }).trim();
  const trailer = "\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>";
  try {
    await mkdir(join(directory, "src/posts/2026"), { recursive: true });
    await mkdir(join(directory, "src/data"), { recursive: true });
    await mkdir(join(directory, "dist"));
    const oldSource = "src/posts/2026/2026-10-01-existing.md";
    await writeFile(join(directory, oldSource), "Existing post\n");
    git("init", "--quiet");
    git("add", oldSource);
    git("commit", "--quiet", "-m", `Existing fixture${trailer}`);
    const base = git("rev-parse", "HEAD");
    await writeFile(join(directory, oldSource), "Edited existing post\n");
    const sources = ["src/posts/2026/2026-10-02-first.md", "src/posts/2026/2026-10-03-second.md"];
    for (const source of sources) await writeFile(join(directory, source), "New post\n");
    git("add", "src/posts");
    git("commit", "--quiet", "-m", `New fixtures${trailer}`);
    const head = git("rev-parse", "HEAD");
    const template = {
      title: "An example announcement", description: "How the announcement previews work",
      tags: [".NET"], date: "2026-10-01T00:00:00Z", draft: false,
    };
    await writeFile(join(directory, "dist/social-posts.json"), JSON.stringify({
      version: 1, origin: "https://example.com",
      posts: [oldSource, ...sources].map((source, index) => ({
        ...template, id: `2026/10/post${index}`, source, url: `https://example.com/2026/10/post${index}`,
      })),
    }));
    await writeFile(join(directory, "src/data/social-config.json"), JSON.stringify({
      enabled: false, archiveReady: false, productionOrigin: "https://example.com",
      bluesky: { handle: "example.com", service: "https://bsky.social" },
      mastodon: { origin: "https://mastodon.online", username: "example", maxCharacters: 500 },
    }));
    execFileSync(process.execPath, [resolve("scripts/social/preview.ts")], {
      cwd: directory, env: { ...process.env, PR_BASE_SHA: base, PR_HEAD_SHA: head }, stdio: "pipe",
    });
    const preview = previewSchema.parse(JSON.parse(await readFile(join(directory, "social-preview.json"), "utf8")));
    expect(preview.posts.map((post) => post.source)).toEqual(sources);
    expect(preview.head).toBe(head);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
