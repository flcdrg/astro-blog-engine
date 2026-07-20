---
name: update-page-metadata
description: 'Review and update Astro blog post/page titles and descriptions. Use for SEO metadata passes, title length checks, frontmatter description cleanup, Bing/webmaster quality reviews, or batch fixes across src/posts years.'
argument-hint: 'target file or folder, e.g. src/posts/2005'
---

# Update Page Metadata

Use this skill to review and improve page/post `title` and `description` metadata for this Astro blog.

## Outcome

The skill produces updated frontmatter metadata that:

- preserves YAML frontmatter delimiters exactly
- keeps existing post body content unchanged unless the user explicitly asks for content edits
- ensures every post has a specific, reader-facing title of at least 15 characters
- ensures every post has a concise, useful, standalone description between 25 and 160 characters
- avoids descriptions that repeat the title verbatim
- follows Australian/British English for reader-facing prose

## When to Use

Use this skill when the user asks to:

- update page titles or descriptions
- review SEO metadata
- fix short or vague titles
- improve frontmatter descriptions
- check a year folder such as `src/posts/2005` or `src/posts/2025`
- review metadata against search quality or webmaster guidelines

## Workflow

1. Load the applicable repo instructions:
   - `.github/instructions/page-description-frontmatter.instructions.md`
   - `.github/instructions/content-language.instructions.md`
2. Run the metadata scanner over the requested target. Use the repo script for the default all-posts scan, or the script directly for a narrower target:

   ```bash
   pnpm run metadata:scan
   ```

   ```bash
   pnpm run metadata:scan --hard-only --summary
   ```

   ```bash
   node .agents/skills/update-page-metadata/scripts/scan-post-metadata.mjs src/posts/2005
   ```

3. Inspect candidates before editing. Use the context extractor for a compact view of frontmatter plus the opening body text:

   ```bash
   node .agents/skills/update-page-metadata/scripts/get-post-metadata-context.mjs src/posts/2005 --only-issues
   ```

4. Decide whether each candidate truly needs a fix:

   | Condition | Action | Notes |
   | --- | --- | --- |
   | Missing title or description, title under 15 characters, description under 25 characters, placeholder metadata, commented-out metadata, description repeating the title, description copied from old link text, vague description, or description that does not stand alone. | Fix. | Treat these as hard metadata quality issues. |
   | Title over 70 characters, description over 160 characters when the user asks to fix a folder or year. | Fix after hard issues are clean. | This takes precedence over leaving accurate historical notes alone; shorten while preserving specificity and accuracy. |
   | Accurate, specific, useful historical note with metadata inside the required limits. | Usually leave alone. | Do not rewrite solely to reach 150-160 characters. |

5. Draft replacements from the actual post content, not just the filename.
6. Apply changes with the JSON apply script for any batch or any older imported Blogger post. Use `apply_patch` only for one or two simple, freshly inspected files:

   ```bash
   node .agents/skills/update-page-metadata/scripts/apply-post-metadata.mjs metadata-updates.json
   ```

7. Immediately validate hard failures after each edit batch before making more edits. Hard failures include short titles, short descriptions, and repeated-title descriptions; long descriptions are advisory:

   ```bash
   node .agents/skills/update-page-metadata/scripts/scan-post-metadata.mjs src/posts/2005 --hard-only --strict
   ```

   If any script exits with a non-zero code or reports an error, stop the workflow, report the exact error output to the user, and do not proceed to the next step until the issue is resolved.

8. Run full advisory validation when the hard-failure check is clean:

   ```bash
   node .agents/skills/update-page-metadata/scripts/scan-post-metadata.mjs src/posts/2005 --strict
   ```

   If this reports only `description.long` issues and the user asked to fix the target folder/year, do a second reviewed JSON batch to shorten those descriptions, then rerun the full strict scan.

9. Remove temporary JSON update files once they have been applied and validated.
10. Run frontmatter and Markdown validation on the edited scope:

    ```bash
    pnpm run validate-frontmatter
    pnpm exec markdownlint-cli2 "src/posts/2005/**/*.md"
    ```

11. Run diagnostics on edited files or folders with the editor error tool when available.

## Decision Points

- If the scanner flags fewer than 10 files, read each flagged file before editing.
- If the scanner flags 10 or more files, use `--summary` to prioritise by issue tag and year, then use `--grouped` or `get-post-metadata-context.mjs --only-issues` before editing in batches.
- Avoid inline shell `node -e` processing for scanner results; use built-in scanner flags such as `--json`, `--summary`, and `--grouped` so zsh does not interpolate template literals or `${...}` expressions.
- If the target is an imported Blogger-era folder, prefer JSON updates even for moderate batches because frontmatter fields may have unusual ordering.
- Keep temporary metadata update JSON files outside `src/posts`, apply them with the script, and delete them after validation.
- If a post is only a link note, write metadata that says what the linked resource is and why it was noted.
- If a title is copied from an external article and includes source, author, or date clutter, shorten it to a clean reader-facing title.
- If a description is copied from a download page or article quote, replace it with a summary sentence.
- If metadata uses YAML block scalars already, preserve the surrounding frontmatter style unless a one-line value is clearly cleaner.
- If a manual patch touches frontmatter delimiters or produces an auto-corrected edit, inspect that file immediately and run the hard-failure scanner before continuing.

## Metadata Quality Rules

- If a `title` or `description` value contains a colon (`:`), wrap the value in quotes to avoid YAML parsing issues.

Titles:

- At least 15 characters, but at most 70 characters.
- Specific enough to identify the topic without relying on the URL.
- Avoid vague titles such as `Notes`, `Update`, `BBS`, `Ouch!`, or acronyms without context.
- Preserve official product and event names.

Descriptions:

- One concise sentence between 25 and 160 characters.
- Summarise what the post is about, not merely the first sentence.
- Avoid clickbait, questions, TODO text, placeholders, and old import artefacts.
- Do not start by repeating the title unless there is no natural alternative.
- Prefer concrete nouns: product names, event names, technology names, locations, and outcomes.

## Scripts

- [scan-post-metadata.mjs](./scripts/scan-post-metadata.mjs) finds missing delimiters, missing metadata, short titles, placeholders, repeated-title descriptions, and description length outliers. Add `--hard-only` to suppress long-description advisory candidates.
- With `--json`, scanner results include `issues` as objects with `text` and `tag` properties, such as `{ "tag": "title.short", "text": "short title (12)" }`.
- Add `--summary` for counts by issue tag and year, or `--grouped` for tab-separated candidates grouped by issue tag.
- `pnpm run metadata:scan` runs the scanner against all posts. Pass flags directly, for example `pnpm run metadata:scan --hard-only`.
- [get-post-metadata-context.mjs](./scripts/get-post-metadata-context.mjs) prints frontmatter and opening body text for drafting better metadata.
- [apply-post-metadata.mjs](./scripts/apply-post-metadata.mjs) applies reviewed `title` and `description` updates from a JSON file while preserving delimiters and body content.

## JSON Update Format

Use this shape with `apply-post-metadata.mjs`:

```json
{
  "src/posts/2005/example.md": {
    "title": "Specific reader-facing title",
    "description": "One concise sentence that summarises the post."
  }
}
```

Only include fields that should change. The script refuses to edit files without valid opening and closing frontmatter delimiters.
If the apply script skips a file due to missing frontmatter delimiters, flag it to the user with the file path and do not attempt a manual patch without first verifying and repairing the delimiters.
