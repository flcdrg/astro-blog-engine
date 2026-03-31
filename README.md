# David's blog engine using Astro

Based on the Astro blog tutorial and customized for this site's publishing workflow.

## Requirements

- Node.js `22.12.0` or newer (Astro v6 requirement)
- `pnpm` (managed via `corepack`)

## Development

```pwsh
corepack enable
pnpm install
pnpm dev
```

## Build

```pwsh
pnpm build
pnpm preview
```

`pnpm build` runs `astro check` and `astro build`.

## Useful scripts

- `pnpm lint` - markdown lint checks
- `pnpm lint:fix` - auto-fix markdown lint issues where possible
- `pnpm validate-frontmatter` - checks post frontmatter placeholders are not left in content

## Project structure

```text
/
├── public/
├── src/
│   ├── components/
│   ├── layouts/
│   ├── pages/
│   ├── posts/
│   ├── styles/
│   └── content.config.ts
├── verified/
└── package.json
```

## Verify generated output

```pwsh
verify --file dist/feed.xml --verified-dir verified --scrub-inline-datetime "yyyy-MM-ddTHH:mm:ss.fffZ"
verify --file .\dist\2025\07\azure-pipeline-template-expression.html --verified-dir verified --scrub-inline-pattern '(?<prefix>")/_astro/[^"]+(?<suffix>")' --scrub-inline-pattern '(?<prefix>title=")[^"]+(?<suffix>")' --scrub-inline-remove ' data-image-component="true"' --scrub-inline-pattern '(?<prefix>meta name="generator" content="Astro v)[\d\.]+(?<suffix>")'
```
