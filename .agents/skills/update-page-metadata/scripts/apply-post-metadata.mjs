#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [mapPath] = process.argv.slice(2);

if (!mapPath) {
  console.error('Usage: node apply-post-metadata.mjs <metadata-updates.json>');
  process.exit(2);
}

const updates = JSON.parse(readFileSync(mapPath, 'utf8'));
let changed = 0;

for (const [file, metadata] of Object.entries(updates)) {
  if (!existsSync(file)) {
    throw new Error(`File not found: ${file}`);
  }

  if (!metadata || typeof metadata !== 'object') {
    throw new Error(`Update for ${file} must be an object`);
  }

  const text = readFileSync(file, 'utf8');
  const openingDelimiter = text.match(/^---\r?\n/)?.[0];
  if (!openingDelimiter) {
    throw new Error(`${file} does not start with an opening frontmatter delimiter`);
  }

  const frontmatterStart = openingDelimiter.length;
  const frontmatterEnd = text.indexOf('\n---', frontmatterStart);
  if (frontmatterEnd === -1) {
    throw new Error(`${file} is missing a closing frontmatter delimiter`);
  }

  let frontmatter = text.slice(frontmatterStart, frontmatterEnd);
  const body = text.slice(frontmatterEnd);
  let touched = false;

  if ('title' in metadata) {
    assertString(metadata.title, `${file} title`);
    frontmatter = setFrontmatterField(frontmatter, 'title', metadata.title);
    touched = true;
  }

  if ('description' in metadata) {
    assertString(metadata.description, `${file} description`);
    frontmatter = setFrontmatterField(frontmatter, 'description', metadata.description);
    touched = true;
  }

  if (touched) {
    writeFileSync(file, `${openingDelimiter}${frontmatter}${body}`);
    console.log(`updated ${file}`);
    changed++;
  }
}

console.log(`Updated files: ${changed}`);

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function setFrontmatterField(frontmatter, field, value) {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => line.match(new RegExp(`^${field}:`)));
  const scalar = toYamlScalar(field, value);

  if (start === -1) {
    const tagsIndex = lines.findIndex((line) => line.match(/^tags:/));
    const insertAt = tagsIndex === -1 ? lines.length : tagsIndex;
    lines.splice(insertAt, 0, scalar);
    return lines.join('\n');
  }

  let end = start + 1;
  const rest = lines[start].replace(new RegExp(`^${field}:\\s*`), '');
  if (rest === '|' || rest === '>' || rest === '>-') {
    while (end < lines.length && !/^[A-Za-z_][A-Za-z0-9_]*:/.test(lines[end])) {
      end++;
    }
  }

  lines.splice(start, end - start, scalar);
  return lines.join('\n');
}

function toYamlScalar(field, value) {
  const normalised = value.trim().replace(/\s+/g, ' ');
  if (normalised.length <= 140 && !normalised.includes(': ')) {
    return `${field}: '${normalised.replace(/'/g, "''")}'`;
  }

  return `${field}: |\n  ${wrap(normalised, 92).join('\n  ')}`;
}

function wrap(value, width) {
  const words = value.split(' ');
  const lines = [];
  let line = '';

  for (const word of words) {
    if (!line) {
      line = word;
    } else if (`${line} ${word}`.length <= width) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines;
}
