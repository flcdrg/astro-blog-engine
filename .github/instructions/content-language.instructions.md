---
description: "Use when writing or editing site content, page copy, blog posts, frontmatter descriptions, README documentation, or reader-facing JSON content. Enforces English Australian and British spelling and grammar conventions for reader-facing text."
name: "Content Language Conventions"
applyTo: "README.md, src/pages/**/*.astro, src/posts/**/*.{md,mdx}, _templates/post.md, src/data/**/*.json"
---

# Content Language Conventions

- Hard rule: use English Australian or British spelling and grammar conventions in reader-facing content.
- This applies to site pages, posts, frontmatter descriptions, README documentation, and reader-facing text stored in JSON data files.
- Prefer Australian spellings such as `organise`, `optimise`, `colour`, `favour`, `centre`, and `licence` when used as a noun.
- Avoid US spellings such as `organize`, `optimize`, `color`, `favor`, `center`, and `license` when the surrounding text is reader-facing prose.
- Use conventions that read naturally for an Australian audience, including date wording, punctuation, and phrasing.
- Preserve official product, company, framework, API, file, and error-message names exactly as published, even when they use US spelling.
- Do not rewrite code, identifiers, URLs, command output, or quoted source text just to force spelling consistency.
- When editing existing content, normalise nearby prose to the same English Australian or British style unless there is a clear reason to preserve the original wording.

Examples:

```md
- Optimise build performance before publishing the post.
- The colour of the status badge changed after the deploy.
- This behaviour is normal for Google Search Console.
```

Keep this rule focused on reader-facing prose rather than code semantics.
