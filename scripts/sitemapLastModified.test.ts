import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { SitemapItem } from "@astrojs/sitemap";
import {
  getNonBlogPageSourceFiles,
  getPostLastModified,
  updateSitemapItemLastModified,
} from "./sitemapLastModified";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createTemporaryPost(content: string) {
  const directory = await mkdtemp(join(tmpdir(), "sitemap-lastmod-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "post.md");
  await writeFile(path, content);
  return path;
}

async function createTemporaryGitRepository() {
  const root = await mkdtemp(join(tmpdir(), "sitemap-lastmod-git-"));
  temporaryDirectories.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Sitemap Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "sitemap-test@example.invalid"], {
    cwd: root,
  });
  return root;
}

async function commitFile(
  root: string,
  relativePath: string,
  content: string,
  date: string,
) {
  const filePath = join(root, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  execFileSync("git", ["add", "--", relativePath], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", `Update ${relativePath}`], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
  });
}

describe("getPostLastModified", () => {
  it("uses the frontmatter date even when modified_time is later", async () => {
    const path = await createTemporaryPost(
      "---\ndate: 2025-01-01T00:00:00.000Z\nmodified_time: 2025-02-03T12:30:00.000Z\n---\nPost",
    );

    expect(getPostLastModified(path)).toBe("2025-01-01T00:00:00.000Z");
  });

  it("returns undefined when frontmatter or a valid date is absent", async () => {
    const missingFrontmatter = await createTemporaryPost("No metadata here");
    const invalidDate = await createTemporaryPost(
      "---\ndate: not-a-date\nmodified_time: 2025-02-03T12:30:00.000Z\n---\nPost",
    );

    expect(getPostLastModified(missingFrontmatter)).toBeUndefined();
    expect(getPostLastModified(invalidDate)).toBeUndefined();
  });
});

describe("getNonBlogPageSourceFiles", () => {
  it("maps generated pages to route templates and directly related data files", () => {
    expect(getNonBlogPageSourceFiles("/2025", "/repo")).toEqual([
      resolve("/repo", "src/pages/[year]/index.astro"),
    ]);
    expect(getNonBlogPageSourceFiles("/tags/dotnet", "/repo")).toEqual([
      resolve("/repo", "src/pages/tags/[tag].astro"),
    ]);
    expect(getNonBlogPageSourceFiles("/speaking", "/repo")).toEqual([
      resolve("/repo", "src/pages/speaking.astro"),
      resolve("/repo", "src/data/speaking.json"),
    ]);
  });
});

describe("updateSitemapItemLastModified", () => {
  it("uses the newest Git commit among a non-blog page's sources", async () => {
    const root = await createTemporaryGitRepository();
    await commitFile(
      root,
      "src/pages/speaking.astro",
      "Speaking page",
      "2025-02-03T12:30:00Z",
    );
    await commitFile(
      root,
      "src/data/speaking.json",
      "[]",
      "2025-02-04T12:30:00Z",
    );

    const item: SitemapItem = {
      url: "https://example.com/speaking",
      lastmod: "2020-01-01T00:00:00.000Z",
    };
    updateSitemapItemLastModified(item, root);

    expect(item.lastmod).toBe("2025-02-04T12:30:00.000Z");
  });

  it("uses only the frontmatter date for blog post URLs", async () => {
    const root = await mkdtemp(join(tmpdir(), "sitemap-lastmod-post-"));
    temporaryDirectories.push(root);
    const postsDirectory = join(root, "src", "posts", "2025");
    await mkdir(postsDirectory, { recursive: true });
    await writeFile(
      join(postsDirectory, "2025-01-01-post.md"),
      "---\ndate: 2025-01-01T00:00:00.000Z\nmodified_time: 2025-02-03T12:30:00.000Z\n---\nPost",
    );

    const item: SitemapItem = {
      url: "https://example.com/2025/01/post",
      lastmod: "2020-01-01T00:00:00.000Z",
    };
    updateSitemapItemLastModified(item, root);

    expect(item.lastmod).toBe("2025-01-01T00:00:00.000Z");
  });
});
