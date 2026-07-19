import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "path";

import { parse } from "node-html-parser";

export async function postProcessSitemap({
  dir,
  siteRoot,
}: {
  dir: URL | string;
  siteRoot: string;
}) {
  const distDir = dir instanceof URL ? fileURLToPath(dir) : dir;
  const sitemapPath = join(distDir, "sitemap-0.xml");
  const content = await readFile(sitemapPath, "utf8");
  const withLinkedPageLastmod = await inferLastModifiedFromLinkedPages(
    content,
    distDir,
    siteRoot,
  );
  const fixed = withLinkedPageLastmod.replace(
    `<loc>${siteRoot}</loc>`,
    `<loc>${siteRoot}/</loc>`,
  );

  if (fixed !== content) {
    await writeFile(sitemapPath, fixed, "utf8");
    console.log(
      `[sitemap-root-trailing-slash] Updated sitemap-0.xml post-processing`,
    );
  }
}

async function inferLastModifiedFromLinkedPages(
  sitemapContent: string,
  distDir: string,
  siteRoot: string,
) {
  const siteRootUrl = new URL(siteRoot);
  const sitemapEntries = getSitemapEntries(sitemapContent);
  const lastmodByUrl = new Map(
    sitemapEntries
      .filter((entry) => entry.lastmod)
      .map((entry) => [entry.loc, entry.lastmod as string]),
  );
  const explicitLastmodUrls = new Set(lastmodByUrl.keys());
  const sitemapUrls = new Set(sitemapEntries.map((entry) => entry.loc));
  const linkedUrlsByUrl = new Map<string, string[]>();

  for (const entry of sitemapEntries) {
    const htmlPath = getBuiltHtmlPathForUrl(entry.loc, distDir, siteRootUrl);

    if (!htmlPath || !existsSync(htmlPath)) {
      continue;
    }

    const html = await readFile(htmlPath, "utf8");
    const root = parse(html);
    const main = root.querySelector("main") ?? root;
    const linkedUrls = main
      .querySelectorAll("a[href]")
      .map((anchor) => anchor.getAttribute("href"))
      .filter((href): href is string => Boolean(href))
      .map((href) => normalizeSitemapUrl(href, entry.loc, siteRootUrl))
      .filter(
        (url): url is string =>
          typeof url === "string" && sitemapUrls.has(url),
      );

    linkedUrlsByUrl.set(entry.loc, [...new Set(linkedUrls)]);
  }

  let updated = true;

  while (updated) {
    updated = false;

    for (const [url, linkedUrls] of linkedUrlsByUrl) {
      const newestLinkedLastmod = linkedUrls
        .map((linkedUrl) => lastmodByUrl.get(linkedUrl))
        .filter((lastmod): lastmod is string => Boolean(lastmod))
        .sort()
        .at(-1);

      if (
        newestLinkedLastmod &&
        !explicitLastmodUrls.has(url) &&
        (!lastmodByUrl.has(url) || newestLinkedLastmod > lastmodByUrl.get(url)!)
      ) {
        lastmodByUrl.set(url, newestLinkedLastmod);
        updated = true;
      }
    }
  }

  return sitemapContent.replace(/<url>\s*([\s\S]*?)\s*<\/url>/g, (block) => {
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];

    if (!loc) {
      return block;
    }

    const lastmod = lastmodByUrl.get(loc);

    if (!lastmod) {
      return block;
    }

    if (block.includes("<lastmod>")) {
      return block.replace(
        /<lastmod>[^<]+<\/lastmod>/,
        `<lastmod>${lastmod}</lastmod>`,
      );
    }

    return block.replace(
      /(<loc>[^<]+<\/loc>)/,
      `$1\n    <lastmod>${lastmod}</lastmod>`,
    );
  });
}

function getSitemapEntries(sitemapContent: string) {
  return [...sitemapContent.matchAll(/<url>\s*([\s\S]*?)\s*<\/url>/g)].flatMap(
    ([, block]) => {
      if (!block) {
        return [];
      }

      const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];

      if (!loc) {
        return [];
      }

      return [
        {
          loc,
          lastmod: block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1],
        },
      ];
    },
  );
}

function getBuiltHtmlPathForUrl(
  loc: string,
  distDir: string,
  siteRootUrl: URL,
) {
  const url = new URL(loc);

  if (url.origin !== siteRootUrl.origin) {
    return undefined;
  }

  const pathname = decodeURIComponent(url.pathname).replace(/\/$/, "");

  if (!pathname) {
    return join(distDir, "index.html");
  }

  return join(distDir, `${pathname.slice(1)}.html`);
}

function normalizeSitemapUrl(href: string, currentUrl: string, siteRootUrl: URL) {
  try {
    const url = new URL(href, currentUrl);

    if (url.origin !== siteRootUrl.origin) {
      return undefined;
    }

    const pathname = url.pathname.replace(/\/$/, "");

    if (!pathname) {
      return siteRootUrl.origin;
    }

    return `${siteRootUrl.origin}${pathname}`;
  } catch {
    return undefined;
  }
}