# David's blog engine using Astro

Based on the astro-blog-tutorial and then customised to fit to how I wanted it to work.

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│   │   └── index.astro
│   └── posts/
| 
└── package.json
```

## Development

- Uses `pnpm` for package management and itself is managed by `corepack`. To upgrade pnpm, use `corepack up`

## Verify

Verify with the following commands:

```pwsh
verify --file dist/feed.xml --verified-dir verified --scrub-inline-datetime "yyyy-MM-ddTHH:mm:ss.fffZ"
verify --file .\dist\2025\07\azure-pipeline-template-expression.html --verified-dir verified --scrub-inline-pattern '(?<prefix>")/_astro/[^"]+(?<suffix>")' --scrub-inline-pattern '(?<prefix>title=")[^"]+(?<suffix>")' --scrub-inline-remove ' data-image-component="true"' --scrub-inline-pattern '(?<prefix>meta name="generator" content="Astro v)[\d\.]+(?<suffix>")'
```
