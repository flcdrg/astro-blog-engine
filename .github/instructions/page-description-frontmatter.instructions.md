---
description: "Use when creating or editing Astro pages or blog post frontmatter. Enforces clear, non-placeholder description frontmatter for SEO, social meta tags, and feed summaries."
name: "Page Description Frontmatter"
applyTo: "src/pages/**/*.astro, src/posts/**/*.{md,mdx}, _templates/post.md"
---
# Page Description Frontmatter

- Hard rule: a page or post is incomplete if description frontmatter is missing, blank, placeholder text, or commented out.
- For Astro pages in src/pages, define a frontmatter object with a description field and pass it to BaseLayout.
- For blog posts in src/posts, include a description field in YAML frontmatter.
- Do not use template placeholders (for example "summary of post"), TODO markers, or commented-out description lines.
- Write the description as one concise sentence that accurately summarizes the page or post.
- Prefer plain language and specific nouns. Avoid clickbait, vague filler, and repeating the title verbatim.
- Keep descriptions roughly 150-160 characters when practical.

Examples:

```astro
---
const pageTitle = "About";
const frontmatter = {
  description: "Background information about David Gardiner, this blog, and the topics covered here.",
};
---

<BaseLayout pageTitle={pageTitle} frontmatter={frontmatter}>
```

```md
---
title: Example post
date: 2026-07-19T10:00:00.000+09:30
description: How to configure frontmatter descriptions in Astro posts for better metadata and feed quality.
tags:
- Astro
---
```
