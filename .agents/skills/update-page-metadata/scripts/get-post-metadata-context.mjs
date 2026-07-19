#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const onlyIssues = args.includes('--only-issues');
const targets = args.filter((arg) => !arg.startsWith('--'));

if (targets.length === 0) {
  console.error('Usage: node get-post-metadata-context.mjs <file-or-folder> [more targets] [--only-issues]');
  process.exit(2);
}

let issueFiles = null;
if (onlyIssues) {
  const scan = spawnSync(
    process.execPath,
    [new URL('./scan-post-metadata.mjs', import.meta.url).pathname, ...targets, '--json'],
    { encoding: 'utf8' }
  );

  if (scan.status !== 0 && !scan.stdout) {
    process.stderr.write(scan.stderr);
    process.exit(scan.status ?? 1);
  }

  issueFiles = new Set(JSON.parse(scan.stdout).map((item) => item.file));
}

const files = targets.flatMap(collectMarkdownFiles).sort();
for (const file of files) {
  const relativePath = relative(process.cwd(), file);
  if (issueFiles && !issueFiles.has(relativePath)) continue;

  const text = readFileSync(file, 'utf8');
  const frontmatterEnd = text.indexOf('\n---', 4);
  const frontmatter = frontmatterEnd === -1 ? '' : text.slice(0, frontmatterEnd + 4);
  const body = frontmatterEnd === -1 ? text : text.slice(frontmatterEnd + 5);
  const firstParagraph = getFirstParagraph(body);

  console.log(`\n### ${relativePath}`);
  console.log(frontmatter || '(missing frontmatter)');
  console.log(`BODY: ${firstParagraph}`);
}

function collectMarkdownFiles(target) {
  if (!existsSync(target)) {
    console.error(`Target not found: ${target}`);
    process.exitCode = 2;
    return [];
  }

  const stats = statSync(target);
  if (stats.isFile()) {
    return target.endsWith('.md') || target.endsWith('.mdx') ? [target] : [];
  }

  if (!stats.isDirectory()) return [];

  return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const child = join(target, entry.name);
    if (entry.isDirectory()) return collectMarkdownFiles(child);
    return entry.name.endsWith('.md') || entry.name.endsWith('.mdx') ? [child] : [];
  });
}

function getFirstParagraph(body) {
  return body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/<!--.*?-->/gs, '').trim())
    .find((paragraph) => paragraph && !paragraph.startsWith('```'))
    ?.replace(/\s+/g, ' ')
    .slice(0, 700) ?? '';
}
