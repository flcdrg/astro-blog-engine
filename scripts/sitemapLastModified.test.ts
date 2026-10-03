import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getPostLastModified } from "./sitemapLastModified";

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

describe("getPostLastModified", () => {
  it("returns the later valid date or modified_time from frontmatter", async () => {
    const path = await createTemporaryPost(
      "---\ndate: 2025-01-01T00:00:00.000Z\nmodified_time: 2025-02-03T12:30:00.000Z\n---\nPost",
    );

    expect(getPostLastModified(path)).toBe("2025-02-03T12:30:00.000Z");
  });

  it("returns undefined when frontmatter or valid timestamps are absent", async () => {
    const missingFrontmatter = await createTemporaryPost("No metadata here");
    const invalidTimestamp = await createTemporaryPost(
      "---\ndate: not-a-date\nmodified_time: also-invalid\n---\nPost",
    );

    expect(getPostLastModified(missingFrontmatter)).toBeUndefined();
    expect(getPostLastModified(invalidTimestamp)).toBeUndefined();
  });
});
