import { execSync } from "child_process";
import { existsSync, globSync } from "node:fs";
import { join, resolve } from "path";

import type { SitemapItem } from "@astrojs/sitemap";

export function updateSitemapItemLastModified(item: SitemapItem) {
  try {
    const urlPattern = /https:\/\/.*?\/(\d{4})\/(\d{2})\/(.+)/;
    const match = item.url.match(urlPattern);

    if (match && match[1] && match[2] && match[3]) {
      updatePostLastModified(item, match[1], match[2], match[3]);
    } else if (item.url.match(/\/about$/)) {
      const filePath = join(process.cwd(), "src", "pages", "about.astro");
      updateLastModifiedFromGit(filePath, item);
    } else if (item.url.match(/\/speaking$/)) {
      const filePath = join(process.cwd(), "src", "pages", "speaking.md");
      updateLastModifiedFromGit(filePath, item);
    }
  } catch (error) {
    console.error(
      `Error processing sitemap item ${item.url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function updatePostLastModified(
  item: SitemapItem,
  year: string,
  month: string,
  slug: string,
) {
  const filePattern = `${year}-${month}-*-${slug}.md`;
  const postsDir = resolve(process.cwd(), "src", "posts", year);

  try {
    if (!existsSync(postsDir)) {
      return;
    }

    const files = globSync(filePattern, { cwd: postsDir });

    if (files.length > 0 && files[0]) {
      const filePath = join(postsDir, files[0]);

      updateLastModifiedFromGit(filePath, item);
    }
  } catch (err) {
    console.error(
      `Error finding file for ${item.url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function updateLastModifiedFromGit(filePath: string, item: SitemapItem) {
  if (!existsSync(filePath)) {
    return;
  }

  const gitCmd = `git log -1 --pretty="format:%cI" "${filePath}"`;
  const lastModified = execSync(gitCmd, { encoding: "utf8" }).trim();

  if (lastModified) {
    item.lastmod = new Date(lastModified).toISOString();
  }
}