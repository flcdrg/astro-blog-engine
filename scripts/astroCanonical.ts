import type { AstroIntegration } from "astro";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type InvalidCanonical = {
  file: string;
  canonical: string;
  problems: string[];
};

function resolveDirPath(dir: URL | string): string {
  if (dir instanceof URL) {
    return fileURLToPath(dir);
  }

  if (dir.startsWith("file:")) {
    return fileURLToPath(dir);
  }

  return dir;
}

export default function astroCanonical(): AstroIntegration {
  let site: string | undefined;
  let trailingSlash: string | undefined;

  return {
    name: "astro-canonical",
    hooks: {
      "astro:config:done": ({ config }) => {
        site = config.site;
        trailingSlash = config.trailingSlash;

        if (!site) {
          throw new Error(
            "[astro-canonical] `site` must be defined in astro.config.mjs"
          );
        }

        if (!site.endsWith("/")) {
          site += "/";
        }
      },
      "astro:build:done": async ({ dir }) => {
        const resolvedSite = site!;
        const distDir = resolveDirPath(dir);
        const htmlFiles: string[] = [];
        const invalidCanonicals: InvalidCanonical[] = [];

        async function walk(folder: string): Promise<void> {
          const entries = await fs.readdir(folder, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = path.join(folder, entry.name);
            if (entry.isDirectory()) {
              await walk(fullPath);
            } else if (entry.isFile() && entry.name.endsWith(".html")) {
              htmlFiles.push(fullPath);
            }
          }
        }

        await walk(distDir);

        let pagesWithCanonical = 0;
        for (const file of htmlFiles) {
          const normalizedFile = file.replace(/\\/g, "/");
          if (
            normalizedFile.endsWith("/404.html") ||
            normalizedFile.endsWith("/404/index.html")
          ) {
            continue;
          }

          const html = await fs.readFile(file, "utf8");
          const match = html.match(
            /<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i
          );

          if (!match) {
            invalidCanonicals.push({
              file: file.replace(distDir, "").replace(/\\/g, "/"),
              canonical: "(missing)",
              problems: ["missing canonical tag"],
            });
            continue;
          }

          const canonical = match[1];
          if (!canonical) {
            invalidCanonicals.push({
              file: file.replace(distDir, "").replace(/\\/g, "/"),
              canonical: "(missing)",
              problems: ["missing canonical href value"],
            });
            continue;
          }

          pagesWithCanonical++;
          const problems: string[] = [];

          if (!canonical.startsWith(resolvedSite)) {
            problems.push(`does not start with site (${resolvedSite})`);
          }

          if (trailingSlash === "always" && !canonical.endsWith("/")) {
            problems.push("missing trailing slash");
          }

          if (trailingSlash === "never" && canonical.endsWith("/")) {
            problems.push("should not have trailing slash");
          }

          if (problems.length > 0) {
            invalidCanonicals.push({
              file: file.replace(distDir, "").replace(/\\/g, "/"),
              canonical,
              problems,
            });
          }
        }

        console.log("\n[astro-canonical] summary");
        console.log("[astro-canonical] site:", resolvedSite);
        console.log("[astro-canonical] trailingSlash:", trailingSlash);
        console.log(`[astro-canonical] HTML files scanned: ${htmlFiles.length}`);
        console.log(`[astro-canonical] pages with canonical: ${pagesWithCanonical}`);
        console.log(
          `[astro-canonical] pages with invalid canonical: ${invalidCanonicals.length}`
        );

        if (invalidCanonicals.length > 0) {
          console.error("\n[astro-canonical] invalid canonicals found:");
          for (const item of invalidCanonicals) {
            console.error(
              `\n- ${item.file}\n` +
                `  canonical: ${item.canonical}\n` +
                `  issues: ${item.problems.join(", ")}`
            );
          }

          throw new Error(
            "[astro-canonical] build failed due to invalid canonical URLs"
          );
        }
      },
    },
  };
}