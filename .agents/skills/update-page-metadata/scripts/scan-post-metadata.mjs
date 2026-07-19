#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const targets = args.filter((arg) => !arg.startsWith('--'));
const strict = args.includes('--strict');
const json = args.includes('--json');
const hardOnly = args.includes('--hard-only');
const summary = args.includes('--summary');
const grouped = args.includes('--grouped');

if (targets.length === 0) {
  console.error('Usage: node scan-post-metadata.mjs <file-or-folder> [more targets] [--strict] [--json] [--hard-only] [--summary] [--grouped]');
  process.exit(2);
}

const placeholderPatterns = [
  /summary of post/i,
  /blog post title/i,
  /\btodo\b/i,
  /untitled/i,
  /image description/i,
];

const files = targets.flatMap(collectMarkdownFiles).sort();
const results = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const issues = [];

  if (!text.match(/^---\r?\n/)) {
    issues.push(createIssue('frontmatter.missing-opening-delimiter', 'missing opening frontmatter delimiter'));
  }

  const frontmatterEnd = text.indexOf('\n---', 4);
  if (frontmatterEnd === -1) {
    issues.push(createIssue('frontmatter.missing-closing-delimiter', 'missing closing frontmatter delimiter'));
  }

  const frontmatter = frontmatterEnd === -1 ? '' : text.slice(4, frontmatterEnd);
  const title = getField(frontmatter, 'title');
  const description = getField(frontmatter, 'description');

  if (hasCommentedField(frontmatter, 'title')) {
    issues.push(createIssue('title.commented-out', 'commented-out title'));
  }

  if (hasCommentedField(frontmatter, 'description')) {
    issues.push(createIssue('description.commented-out', 'commented-out description'));
  }

  if (!title) {
    issues.push(createIssue('title.missing', 'missing title'));
  } else {
    if (title.length < 15) {
      issues.push(createIssue('title.short', `short title (${title.length})`));
    }

    if (placeholderPatterns.some((pattern) => pattern.test(title))) {
      issues.push(createIssue('title.placeholder', 'placeholder title'));
    }
  }

  if (!description) {
    issues.push(createIssue('description.missing', 'missing description'));
  } else {
    if (description.length < 25) {
      issues.push(createIssue('description.short', `short description (${description.length})`));
    }

    if (description.length > 160) {
      issues.push(createIssue('description.long', `long description (${description.length})`));
    }

    if (placeholderPatterns.some((pattern) => pattern.test(description))) {
      issues.push(createIssue('description.placeholder', 'placeholder description'));
    }

    if (startsByRepeatingTitle(title, description)) {
      issues.push(createIssue('description.repeats-title', 'description repeats title'));
    }
  }

  const visibleIssues = hardOnly ? issues.filter(isHardIssue) : issues;

  if (visibleIssues.length > 0) {
    results.push({
      file: relative(process.cwd(), file),
      issues: visibleIssues,
      title,
      description,
    });
  }
}

if (json) {
  console.log(JSON.stringify(results, null, 2));
} else if (summary) {
  printSummary(results);
} else if (grouped) {
  printGrouped(results);
} else if (results.length === 0) {
  console.log('Metadata scan passed');
} else {
  for (const result of results) {
    console.log(`\n${result.file}`);
    console.log(`  issues: ${result.issues.map((issue) => issue.text).join(', ')}`);
    if (result.title) console.log(`  title: ${result.title}`);
    if (result.description) console.log(`  description: ${result.description}`);
  }
  console.log(`\nCandidates: ${results.length}`);
}

if (strict && results.length > 0) {
  process.exitCode = 1;
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

  if (!stats.isDirectory()) {
    return [];
  }

  return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const child = join(target, entry.name);
    if (entry.isDirectory()) return collectMarkdownFiles(child);
    return entry.name.endsWith('.md') || entry.name.endsWith('.mdx') ? [child] : [];
  });
}

function getField(frontmatter, field) {
  const lines = frontmatter.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(new RegExp(`^${field}:\\s*(.*)$`));
    if (!match) continue;

    const rest = match[1] ?? '';
    if (rest === '|' || rest === '>' || rest === '>-') {
      const parts = [];
      for (let next = index + 1; next < lines.length; next++) {
        if (/^[A-Za-z_][A-Za-z0-9_]*:/.test(lines[next])) break;
        parts.push(lines[next].replace(/^\s+/, ''));
      }
      return parts.join(' ').trim();
    }

    return unwrapScalar(rest);
  }

  return '';
}

function unwrapScalar(value) {
  return value.trim().replace(/^['"]|['"]$/g, '').replace(/''/g, "'").trim();
}

function hasCommentedField(frontmatter, field) {
  return new RegExp(`^#\\s*${field}:`, 'm').test(frontmatter);
}

function startsByRepeatingTitle(title, description) {
  const normalTitle = normalise(title);
  const normalDescription = normalise(description);
  if (!normalTitle || !normalDescription) return false;

  const prefix = normalTitle.slice(0, Math.min(normalTitle.length, 45));
  return normalDescription.startsWith(prefix);
}

function normalise(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isHardIssue(issue) {
  return issue.tag !== 'description.long';
}

function createIssue(tag, text) {
  return { tag, text };
}

function printSummary(results) {
  if (results.length === 0) {
    console.log('Metadata scan passed');
    return;
  }

  console.log(`Files: ${results.length}`);
  console.log('\nIssues:');
  for (const [tag, count] of countIssuesByTag(results)) {
    console.log(`  ${tag}: ${count}`);
  }

  console.log('\nFiles by year:');
  for (const [year, count] of countResultsByYear(results)) {
    console.log(`  ${year}: ${count}`);
  }
}

function printGrouped(results) {
  if (results.length === 0) {
    console.log('Metadata scan passed');
    return;
  }

  const tags = [...new Set(results.flatMap((result) => result.issues.map((issue) => issue.tag)))].sort();

  for (const tag of tags) {
    console.log(`\n## ${tag}`);
    for (const result of results.filter((item) => item.issues.some((issue) => issue.tag === tag))) {
      console.log(`${result.file}\t${result.title ?? ''}\t${result.description ?? ''}`);
    }
  }

  console.log(`\nCandidates: ${results.length}`);
}

function countIssuesByTag(results) {
  const counts = new Map();
  for (const result of results) {
    for (const issue of result.issues) {
      counts.set(issue.tag, (counts.get(issue.tag) ?? 0) + 1);
    }
  }

  return [...counts].sort(([firstTag], [secondTag]) => firstTag.localeCompare(secondTag));
}

function countResultsByYear(results) {
  const counts = new Map();
  for (const result of results) {
    const year = result.file.match(/src\/posts\/(\d{4})\//)?.[1] ?? 'other';
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }

  return [...counts].sort(([firstYear], [secondYear]) => firstYear.localeCompare(secondYear));
}
