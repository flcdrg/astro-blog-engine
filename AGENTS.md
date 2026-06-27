# Instructions

This file provides guidance to agents when working with code in this repository.

This is a static blog (Dave's Daydreams) built with Astro v7, deployed to Cloudflare Pages.

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
pnpm verify                 # run all Verify.Cli snapshot checks (verify:dist, verify:post, verify:index)
```

The `verify*` scripts require `dist/` to exist (run `pnpm build` first) and the `verify` (Verify.Cli) tool to be installed.

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

- `src/layouts/BaseLayout.astro` — root layout; handles `<head>`, nav, footer, canonical link, and site-wide JSON-LD. The JSON-LD is an `@graph` containing an `Organization` (with `sameAs` social links) and a `WebSite` (with a `SearchAction` pointing at `/tags/{search_term_string}`).
- `src/layouts/MarkdownPostLayout.astro` — wraps blog post content; adds Disqus comments and post-specific JSON-LD: a `BlogPosting` plus one or more `BreadcrumbList` trails — a primary archive trail (`Archive → Year → Post`) and a secondary trail per tag (`Tags → Tag → Post`). Breadcrumb trails deliberately omit the site root.
- `BaseLayout` exposes a `site-title` slot (default: `<SiteTitle />`). Only `index.astro` overrides it.
- `BaseLayout` also exposes a `head` slot for extra `<head>` content.
- Google Analytics (gtag) is only injected when the resolved `Astro.site` host is `david.gardiner.net.au`, so preview deploys don't emit analytics.

### Sitemap (`astro.config.ts`)

- The `serialize` callback strips trailing slashes from all URLs and injects `lastmod` from `git log` for blog posts, `/about`, and `/speaking`.
- Post git dates are resolved by reconstructing the file path from the URL pattern `/YYYY/MM/slug`.
- Site URL defaults to `https://david.gardiner.net.au`; overridden by `DEPLOY_PRIME_URL` env var.

### Dates

- Use Luxon for all date handling. Display relative to `Australia/Adelaide` timezone.
- `DateTime.fromISO(iso, { zone: "Australia/Adelaide" })`, format via `toLocaleString`.

### Diagrams

- Mermaid diagrams are supported via the `astro-mermaid` integration (`astro.config.ts`), configured with the `forest` theme, `autoTheme`, and the `logos`/`iconoir` icon packs (fetched from unpkg at build time).

### Verification / snapshot testing

- `verified/` holds `.verified.*` snapshot files used by [Verify.Cli](https://github.com/VerifyTests/Verify) for regression testing in CI.
- Run locally with `pnpm verify` (after `pnpm build`). The scripts verify `dist/feed.xml`, `dist/index.html`, and a specific post HTML file (`dist/2025/07/azure-pipeline-template-expression.html`); CI also verifies HTTP redirect traces.
- Scrubbers in the `verify:*` scripts normalize hashed `/_astro/` asset names, `title="..."` attributes, the Astro generator version, and the `data-image-component` marker so snapshots stay stable across builds.
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

## Content schemas (Astro v7)

- Import `z` from `astro/zod` (not from `astro:content` or `astro:schema`).
- Post front matter fields: `date` (ISO datetime with offset, required), `title` (required), `draft` (optional bool, defaults `false`), `tags` (string array, defaults `["others"]`), `image` (optional, resolved via Astro's `image()` helper), `imageAlt`, `description`.
