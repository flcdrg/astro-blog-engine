import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  getBuiltHtmlPathForUrl,
  getSitemapEntries,
  inferLastModifiedFromLinkedPages,
  normalizeSitemapUrl,
  postProcessSitemap,
  removeNoindexPages,
} from "./sitemapPostProcess";

const siteRoot = "https://example.com";
const siteRootUrl = new URL(siteRoot);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "sitemap-post-process-"));
  temporaryDirectories.push(directory);
  return directory;
}

function entry(loc: string, lastmod?: string) {
  return `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
}

describe("getSitemapEntries", () => {
  it("extracts locations and optional lastmod values, skipping invalid entries", () => {
    expect(
      getSitemapEntries(
        `<url><loc>${siteRoot}/one</loc><lastmod>2025-01-01</lastmod></url><url><loc>${siteRoot}/two</loc></url><url><lastmod>2025-01-02</lastmod></url>`,
      ),
    ).toEqual([
      { loc: `${siteRoot}/one`, lastmod: "2025-01-01" },
      { loc: `${siteRoot}/two`, lastmod: undefined },
    ]);
  });
});

describe("getBuiltHtmlPathForUrl", () => {
  it("maps root and page URLs to built HTML files and rejects other origins", () => {
    expect(getBuiltHtmlPathForUrl(siteRoot, "/dist", siteRootUrl)).toBe(
      join("/dist", "index.html"),
    );
    expect(
      getBuiltHtmlPathForUrl(`${siteRoot}/2025/01/post/`, "/dist", siteRootUrl),
    ).toBe(join("/dist", "2025/01/post.html"));
    expect(
      getBuiltHtmlPathForUrl("https://other.example/post", "/dist", siteRootUrl),
    ).toBeUndefined();
  });
});

describe("normalizeSitemapUrl", () => {
  it("resolves relative links, removes trailing slashes, and rejects other origins", () => {
    expect(
      normalizeSitemapUrl("../other/", `${siteRoot}/2025/01/post`, siteRootUrl),
    ).toBe(`${siteRoot}/2025/other`);
    expect(
      normalizeSitemapUrl("https://other.example/post", siteRoot, siteRootUrl),
    ).toBeUndefined();
  });
});

describe("removeNoindexPages", () => {
  it("removes sitemap entries whose built HTML declares noindex", async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(
      join(directory, "hidden.html"),
      '<meta name="robots" content="noindex, follow">',
    );
    const sitemap = `<url><loc>${siteRoot}/hidden</loc></url>${entry(`${siteRoot}/visible`)}`;

    const result = await removeNoindexPages(sitemap, directory, siteRoot);

    expect(result).not.toContain(`${siteRoot}/hidden`);
    expect(result).toContain(`${siteRoot}/visible`);
  });
});

describe("inferLastModifiedFromLinkedPages", () => {
  it("propagates linked lastmod values through pages without changing explicit values", async () => {
    const directory = await createTemporaryDirectory();
    const newest = `${siteRoot}/newest`;
    const middle = `${siteRoot}/middle`;
    const parent = `${siteRoot}/parent`;
    const olderExplicit = `${siteRoot}/explicit`;
    await writeFile(join(directory, "parent.html"), `<main><a href="/middle">next</a></main>`);
    await writeFile(join(directory, "middle.html"), `<main><a href="/newest">next</a></main>`);
    await writeFile(join(directory, "explicit.html"), `<main><a href="/newest">next</a></main>`);
    const sitemap = [
      entry(parent),
      entry(middle),
      entry(newest, "2025-03-04"),
      entry(olderExplicit, "2024-01-02"),
    ].join("");

    const result = await inferLastModifiedFromLinkedPages(
      sitemap,
      directory,
      siteRoot,
    );

    expect(result).toContain(`<loc>${parent}</loc>\n    <lastmod>2025-03-04</lastmod>`);
    expect(result).toContain(`<loc>${middle}</loc>\n    <lastmod>2025-03-04</lastmod>`);
    expect(result).toContain(`<loc>${olderExplicit}</loc><lastmod>2024-01-02</lastmod>`);
  });
});

describe("postProcessSitemap", () => {
  it("restores a trailing slash to the root entry", async () => {
    const directory = await createTemporaryDirectory();
    const sitemapPath = join(directory, "sitemap-0.xml");
    await writeFile(sitemapPath, `<url><loc>${siteRoot}</loc></url>`);

    await postProcessSitemap({ dir: directory, siteRoot });

    expect(await readFile(sitemapPath, "utf8")).toContain(
      `<loc>${siteRoot}/</loc>`,
    );
  });
});
