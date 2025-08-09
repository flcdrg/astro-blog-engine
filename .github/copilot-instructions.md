# Copilot Instructions

This is a static website using Astro. Use pnpm for all Node package operations. `layouts/BaseLayout.astro` is the root layout template.

## Tooling

- Node: Use LTS (recommend 20.x). Prefer `.nvmrc`/`.node-version` if adding engine constraints.
- Package manager: pnpm only. Do not suggest npm/yarn commands.

Common commands:

- `pnpm install`
- `pnpm dev` (local dev)
- `pnpm build` (outputs to `dist/`)
- `pnpm preview`

## Project structure

- Layouts: `src/layouts/BaseLayout.astro` is the root layout. Put global head/nav/footer there.
- Components: `src/components/*`. Keep components small and reusable.
- Styles: Global styles in `src/styles/global.css`. Prefer component-scoped styles otherwise.

## Layout and slots

- Base layout exposes a named slot `site-title` with `<SiteTitle />` as the default.
- Only override the site title on the index page by providing `<slot name="site-title">` content in `index.astro`. Other pages should not pass this slot so the default applies.

Example (index.astro):

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
---
<BaseLayout>
  <div slot="site-title">
    <h1>Custom Home Page Title</h1>
  </div>
  <!-- page content -->
</BaseLayout>
```

## Dates and timezone

- Use Luxon for dates. Display dates relative to the Australia/Adelaide timezone.
- Prefer `DateTime.fromISO(iso, { zone: "Australia/Adelaide" })` and format via `toLocaleString` with proper options.

## Environment variables

- Use `.env` and `import.meta.env` in Astro. Do not use hyphens in shell variable names (invalid in Bash).
- For CI, reference variables via the platform’s env mechanism (e.g., `AZURE_*`, `VERCEL_*`, etc.).

## Code style

- Prefer TypeScript where possible (Astro supports TS in components and scripts).
- Use Prettier and ESLint if configured. Follow existing import order and file naming conventions.
- Keep components accessible (semantic HTML, alt text, labels, focus states).

## Performance and assets

- Optimize images (Astro `<Image />` or build-time tooling).
- Keep CSS small; avoid unused global styles.
- Defer or module-load scripts when possible.

## CI/CD

- In pipelines, use pnpm setup/caching.
- Build with `pnpm install --frozen-lockfile && pnpm build`.
- Publish `dist/` as the static artifact.

## VS Code

- Recommend the Astro extension.
- Configure format-on-save and TypeScript/ESLint where applicable.

When suggesting changes:

- Use pnpm commands.
- Target correct file paths under `src/`.
- Prefer Astro components and slots over raw HTML duplication.
- Keep examples minimal and production
