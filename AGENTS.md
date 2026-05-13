# Instructions

This file provides guidance to agents when working with code in this repository.

This is a static blog (Dave's Daydreams) built with Astro v6, deployed to Cloudflare Pages.

## Tooling

- Node: `>=24 <25` (see `package.json` engines). Use `package.json` as the node-version-file in CI.
- Package manager: pnpm only. Do not suggest npm/yarn commands.

## Commands

```bash
pnpm install
pnpm dev                    # local dev server (future-dated posts visible in dev, hidden in prod)
pnpm build                  # runs astro check then astro build; outputs to dist/
pnpm preview
pnpm run validate-frontmatter  # checks posts don't have unfilled template placeholders
pnpm lint                   # markdownlint-cli2 on markdown files
pnpm lint:fix
```

## Architecture

### Content collection

- Blog posts live in `src/posts/<year>/YYYY-MM-DD-slug.md` (or `.mdx`).
- The collection loader (`src/content.config.ts`) strips the `YYYY-MM-DD-` date prefix (first 16 chars) from the filename and builds the post ID as `yyyy/MM/slug` using the `date` front matter field parsed with Luxon.
- `src/scripts/filters.ts` exports `onlyCurrent` — future-dated posts are excluded in production builds but shown in dev mode.
- Collection schema is in `src/content.config.ts`; import `z` from `astro/zod`, not `astro:content`.

### Build format and URLs

- `build.format` is set to `'file'` — pages render as `page.html`, not `page/index.html`. This must not be changed.
- Because of `build.format: 'file'`, `@astrojs/sitemap` hard-codes a stream-level replacement that strips trailing slashes from all `<loc>` values. A custom inline integration (`sitemap-root-trailing-slash` in `astro.config.ts`) post-processes `dist/sitemap-0.xml` after the build to restore the trailing slash on the root URL only.
- Canonical URLs are computed in `src/scripts/canonical.ts`: strips `.html` extension, maps `/index` → `/`.
- The `astroCanonical` integration (`scripts/astroCanonical.ts`) validates every HTML page has a correct canonical tag at build time; the build fails if any are missing or wrong.

### Layouts and slots

- `src/layouts/BaseLayout.astro` — root layout; handles `<head>`, nav, footer, JSON-LD structured data, and canonical link.
- `src/layouts/MarkdownPostLayout.astro` — wraps blog post content; adds post-specific JSON-LD, Disqus comments.
- `BaseLayout` exposes a `site-title` slot (default: `<SiteTitle />`). Only `index.astro` overrides it.
- `BaseLayout` also exposes a `head` slot for extra `<head>` content.

### Sitemap (`astro.config.ts`)

- The `serialize` callback strips trailing slashes from all URLs and injects `lastmod` from `git log` for blog posts, `/about`, and `/speaking`.
- Post git dates are resolved by reconstructing the file path from the URL pattern `/YYYY/MM/slug`.
- Site URL defaults to `https://david.gardiner.net.au`; overridden by `DEPLOY_PRIME_URL` env var.

### Dates

- Use Luxon for all date handling. Display relative to `Australia/Adelaide` timezone.
- `DateTime.fromISO(iso, { zone: "Australia/Adelaide" })`, format via `toLocaleString`.

### Verification / snapshot testing

- `verified/` holds `.verified.*` snapshot files used by [Verify.Cli](https://github.com/VerifyTests/Verify) for regression testing in CI.
- CI verifies `dist/feed.xml`, `dist/index.html`, a specific post HTML file, and HTTP redirect traces.
- To update a snapshot, copy the `.received.*` file over the corresponding `.verified.*` file.

## CI/CD

- **PR builds**: `pnpm build --devOutput` (includes future-dated posts).
- **Production builds**: `pnpm build` on push to `main`.
- Deployed to Cloudflare Pages via Wrangler (`wrangler deploy` for production, `wrangler versions upload` for PR previews).
- PR preview jobs also run `Test-HttpRedirects.ps1` and verify HTTP trace snapshots.
- Link checking uses lychee; Lighthouse CI runs on every build.
- The `.astro/` directory and `dist/` are cached in CI keyed on `pnpm-lock.yaml`.

## Environment variables

- `DEPLOY_PRIME_URL` — overrides the site URL (used in Cloudflare preview deploys).
- Use `import.meta.env` in Astro components/pages. Do not use hyphens in shell variable names.

## Content schemas (Astro v6)

- Import `z` from `astro/zod` (not from `astro:content` or `astro:schema`).
- Post front matter fields: `date` (ISO datetime with offset, required), `title`, `draft` (optional bool), `tags` (string array), `image`, `imageAlt`, `description`.
