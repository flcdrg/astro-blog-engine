import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "path";

export async function postProcessHomepage({
  dir,
}: {
  dir: URL | string;
}) {
  const distDir = dir instanceof URL ? fileURLToPath(dir) : dir;
  const homepagePath = join(distDir, "index.html");

  if (!existsSync(homepagePath)) {
    return;
  }

  const content = await readFile(homepagePath, "utf8");
  const updated = content.replace(
    /(<article\b[^>]*\bdata-full-post-content\b[^>]*>)([\s\S]*?)(<\/article>)/g,
    (_, openTag: string, articleContent: string, closeTag: string) =>
      `${openTag}${demoteHeadingLevels(articleContent)}${closeTag}`,
  );

  if (updated !== content) {
    await writeFile(homepagePath, updated, "utf8");
    console.log("[homepage-heading-demotion] Updated heading levels in index.html");
  }
}

function demoteHeadingLevels(html: string): string {
  let demoted = html;

  for (let level = 5; level >= 1; level -= 1) {
    const deeperLevel = level + 1;
    demoted = demoted
      .replaceAll(
        new RegExp(`<h${level}(\\b[^>]*)>`, "g"),
        `<h${deeperLevel}$1>`,
      )
      .replaceAll(new RegExp(`</h${level}>`, "g"), `</h${deeperLevel}>`);
  }

  return demoted;
}
