import { execFileSync } from "node:child_process";
import { existsSync, globSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { SitemapItem } from "@astrojs/sitemap";

const nonBlogPageSources: Record<string, string[]> = {
  "/": ["src/pages/index.astro"],
  "/about": ["src/pages/about.astro"],
  "/archive": ["src/pages/archive.astro"],
  "/feed.xml": ["src/pages/feed.xml.ts"],
  "/speaking": ["src/pages/speaking.astro", "src/data/speaking.json"],
  "/tags": ["src/pages/tags/index.astro"],
};

export function updateSitemapItemLastModified(
  item: SitemapItem,
  root = process.cwd(),
) {
  try {
    const pathname = new URL(item.url).pathname;
    const postMatch = pathname.match(/^\/(\d{4})\/(\d{2})\/([^/]+)$/);

    if (postMatch?.[1] && postMatch[2] && postMatch[3]) {
      delete item.lastmod;
      updatePostLastModified(
        item,
        postMatch[1],
        postMatch[2],
        decodeURIComponent(postMatch[3]),
        root,
      );
      return;
    }

    delete item.lastmod;
    const sourceFiles = getNonBlogPageSourceFiles(pathname, root);
    if (sourceFiles) {
      updateLastModifiedFromGit(sourceFiles, item, root);
    } else {
      console.error(`No source files configured for sitemap item ${item.url}`);
    }
  } catch (error) {
    console.error(
      `Error processing sitemap item ${item.url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function getNonBlogPageSourceFiles(
  pathname: string,
  root = process.cwd(),
): string[] | undefined {
  let relativePaths = nonBlogPageSources[pathname];

  if (!relativePaths && /^\/\d{4}$/.test(pathname)) {
    relativePaths = ["src/pages/[year]/index.astro"];
  } else if (!relativePaths && /^\/tags\/[^/]+$/.test(pathname)) {
    relativePaths = ["src/pages/tags/[tag].astro"];
  } else if (!relativePaths && /^\/tags\/[^/]+\.xml$/.test(pathname)) {
    relativePaths = ["src/pages/tags/[tag].xml.ts"];
  }

  return relativePaths?.map((relativePath) => resolve(root, relativePath));
}

function updatePostLastModified(
  item: SitemapItem,
  year: string,
  month: string,
  slug: string,
  root: string,
) {
  const postsDir = resolve(root, "src", "posts", year);

  try {
    if (!existsSync(postsDir)) {
      return;
    }

    const filePath = [".md", ".mdx"]
      .flatMap((extension) =>
        globSync(`${year}-${month}-*-${slug}${extension}`, {
          cwd: postsDir,
        }),
      )
      .map((file) => join(postsDir, file))
      .at(0);

    if (filePath) {
      const lastModified = getPostLastModified(filePath);
      if (lastModified) {
        item.lastmod = lastModified;
      }
    }
  } catch (err) {
    console.error(
      `Error finding file for ${item.url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function getPostLastModified(filePath: string): string | undefined {
  const frontmatter = readFileSync(filePath, "utf8").match(
    /^---\r?\n([\s\S]*?)\r?\n---/,
  )?.[1];

  if (!frontmatter) {
    return undefined;
  }

  const date = frontmatter.match(/^date:\s*['"]?([^'"\r\n]+)/m)?.[1];
  const timestamp = date ? Date.parse(date.trim()) : NaN;

  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : undefined;
}

function updateLastModifiedFromGit(
  filePaths: string[],
  item: SitemapItem,
  root: string,
) {
  const timestamps = filePaths
    .filter(existsSync)
    .map((filePath) => {
      const timestamp = execFileSync(
        "git",
        ["log", "-1", "--format=%cI", "--", filePath],
        { cwd: root, encoding: "utf8" },
      ).trim();
      return Date.parse(timestamp);
    })
    .filter((timestamp) => Number.isFinite(timestamp));

  if (timestamps.length > 0) {
    item.lastmod = new Date(Math.max(...timestamps)).toISOString();
  }
}
