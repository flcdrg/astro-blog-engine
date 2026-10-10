import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "astro/zod";
import { importDisqusXml } from "../src/scripts/social/archive-import.ts";
import { manifestSchema } from "../src/scripts/social/schema.ts";

export { importDisqusXml } from "../src/scripts/social/archive-import.ts";

export function runDisqusImport(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      export: { type: "string" },
      manifest: { type: "string", default: "dist/social-posts.json" },
      output: { type: "string", default: "src/data/legacy-comments.json" },
      "approved-ids": { type: "string" },
    },
    strict: true,
  });
  if (!values.export) throw new Error("Usage: import-disqus --export disqus.xml [--manifest dist/social-posts.json] [--output src/data/legacy-comments.json] [--approved-ids reviewed-approved-ids.json]");
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(values.manifest!, "utf8")));
  const approvedIds = new Set(values["approved-ids"]
    ? z.array(z.string().min(1)).parse(JSON.parse(readFileSync(values["approved-ids"], "utf8"))) : []);
  const result = importDisqusXml(
    readFileSync(values.export, "utf8"), manifest.origin, new Set(manifest.posts.map((post) => post.id)), approvedIds,
  );
  writeFileSync(values.output!, `${JSON.stringify(result.archive, null, 2)}\n`);
  console.log(`Imported ${result.importedComments} comments in ${Object.keys(result.archive.threads).length} threads; skipped ${result.skippedPosts} posts.`);
  if (result.unmatchedThreads.length) console.warn(`Unmatched thread IDs: ${result.unmatchedThreads.join(", ")}`);
  if (result.unknownApprovalPosts) console.warn(`Skipped ${result.unknownApprovalPosts} comments without approval evidence. Supply --approved-ids only after reviewing public approval.`);
  console.log("Review the sanitised archive diff against the export before setting archiveReady to true.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runDisqusImport(process.argv.slice(2));
}
