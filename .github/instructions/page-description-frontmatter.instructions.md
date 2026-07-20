---
description: "Use when creating or editing Astro pages or blog post frontmatter. Enforces clear, non-placeholder titles and descriptions for SEO, social meta tags, and feed summaries."
name: "Page Metadata Frontmatter"
applyTo: "src/pages/**/*.astro, src/posts/**/*.{md,mdx}, _templates/post.md"
---
# Page Metadata Frontmatter

- Hard rule: a page or post is incomplete if title or description metadata is missing, blank, placeholder text, or commented out. Ignore this rule only if the page body contains no prose sentences -- for example, a blank file or a file containing only frontmatter delimiters and comments.
- Preserve YAML frontmatter delimiters: Markdown posts and templates must start with an opening `---` line and keep the closing `---` line before the body content.
- For Astro pages in src/pages, define a pageTitle constant and a frontmatter object with a description field, then pass both to BaseLayout.
- For blog posts in src/posts, include title and description fields in YAML frontmatter.
- Do not use template placeholders (for example "summary of post"), TODO markers, or commented-out title or description lines.
- If a title or description value contains a colon (`:`), wrap the full value in quotes to avoid YAML parsing issues.
- Write titles that are specific, reader-facing, and at least 15 characters long, and at most 70 characters.
- Avoid vague titles such as "Update", "Notes", "About", or "Untitled" unless expanded with specific context.
- Write the description as one concise sentence that accurately summarises the page or post. It does not need to end with a period.
- Prefer plain language and specific nouns. Avoid clickbait, vague filler, and repeating the title verbatim.
- Keep descriptions between 25-160 characters.

Examples:

```astro
---
const pageTitle = "About David Gardiner";
const frontmatter = {
  description: "Background information about David Gardiner, this blog, and the topics covered here.",
};
---

<BaseLayout pageTitle={pageTitle} frontmatter={frontmatter}>
```

```md
---
title: Configuring Astro metadata
date: 2026-07-19T10:00:00.000+09:30
description: How to configure frontmatter titles and descriptions in Astro posts for better metadata and feed quality.
tags:
- Astro
---
```
