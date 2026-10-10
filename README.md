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

```bash
verify --file dist/feed.xml --verified-dir verified --scrub-inline-datetime "yyyy-MM-ddTHH:mm:ss.fffZ"
verify --file dist/2025/07/azure-pipeline-template-expression.html --verified-dir verified --scrub-inline-pattern '(?<prefix>")/_astro/[^"]+(?<suffix>")' --scrub-inline-pattern '(?<prefix>title=")[^"]+(?<suffix>")' --scrub-inline-remove ' data-image-component="true"' --scrub-inline-pattern '(?<prefix>meta name="generator" content="Astro v)[\d\.]+(?<suffix>")'
verify --file ./dist/index.html --verified-dir verified --scrub-inline-pattern '(?<prefix>")/_astro/[^"]+(?<suffix>")' --scrub-inline-pattern '(?<prefix>title=")[^"]+(?<suffix>")' --scrub-inline-remove ' data-image-component="true"' --scrub-inline-pattern '(?<prefix>meta name="generator" content="Astro v)[\d\.]+(?<suffix>")'
```

## Only for astro-blog-engine

```bash
verify --file ./dist/index.html --verified-dir verified --scrub-inline-pattern '(?<prefix>")/_astro/[^"]+(?<suffix>")' --scrub-inline-pattern '(?<prefix>title=")[^"]+(?<suffix>")' --scrub-inline-remove ' data-image-component="true"' --scrub-inline-pattern '(?<prefix>meta name="generator" content="Astro v)[\d\.]+(?<suffix>")'
```

## Bluesky and Mastodon discussions

The site remains static. Posts can display live public replies from either network,
loaded when their discussion section becomes visible. Source links work without
JavaScript. Visitors' browsers contact the social APIs directly; counts and replies
are previews, not a complete archive of federated conversations.

Supply thread URLs in frontmatter, or use the generated mappings in
`src/data/social-posts.json`. Frontmatter takes precedence:

```yaml
blueskyUrl: https://bsky.app/profile/your.handle/post/3abc123
mastodonUrl: https://your.instance/@yourname/123456789012345678
```

### Automated announcements

Publishing is **disabled by default**. Configure `src/data/social-config.json` in
the production content repository, not just the engine. Set its production origin,
account identities and `enabled: true`; remove a provider object to disable that
network. Also set the repository variable `SOCIAL_PUBLISHING_ENABLED=true`.

You can use `src/data/social-config.jsonc` instead to allow comments and trailing
commas. If both files exist, the `.json` file takes precedence. Both formats use
the same configuration validation.

Announcements run only after a successful production deployment on `main`, including
scheduled builds. The complete `dist/social-posts.json` manifest, rather than the
ten-entry feed, supplies eligible non-draft posts. PR builds include scheduled and
draft posts for previews without publishing them.

The format is `Blogged: <title>`, description, canonical production URL and hashtags
derived from tags (`.NET` becomes `#dotnet`). Descriptions are shortened first,
then optional hashtags/title if necessary; the URL is preserved. Mastodon uploads
the resolved frontmatter image if present, using `imageAlt` as its description.
Missing alt text or failed media preparation defers that network instead of silently
posting without the requested image. A new post needs a non-empty description to
prepare an announcement or PR preview.

Configure production environment secrets:

| Secret                  | Purpose                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `BLUESKY_APP_PASSWORD`  | App password for the configured Bluesky account                                                           |
| `MASTODON_ACCESS_TOKEN` | Token with `read:accounts`, `write:statuses` and `write:media`                                            |
| `SOCIAL_GITHUB_TOKEN`   | Dedicated GitHub App installation token or narrowly scoped token with repository contents/PR write access |

Prefer a dedicated GitHub App. It writes publishing state to a branch and opens
mapping PRs. To create and configure it:

1. Open **GitHub Settings → Developer settings → GitHub Apps → New GitHub App**.
   For an organisation-owned app, use the organisation's settings instead.
2. Choose a unique name, such as `Astro Blog Social Publisher`, and set the
   **Homepage URL** to your repository URL. Untick **Active** under **Webhook**,
   leave OAuth callback settings unused, and select **Only on this account** for
   installation.
3. Under **Repository permissions**, grant **Contents: Read and write** and
   **Pull requests: Read and write**. **Metadata: Read-only** is included
   automatically. No organisation permissions or subscribed events are needed.
4. Create the app and copy its **App ID**, not its Client ID. Click
   **Generate a private key** to download the PEM file.
5. Under **Install App**, install it on your account using
   **Only select repositories**. Select the engine repository for testing, or the
   production content repository for production. Explicitly add the production
   repository later when ready; do not grant access to all repositories.
6. In the target repository's **Settings → Secrets and variables → Actions →
   Variables**, set `SOCIAL_APP_ID` to the App ID and
   `SOCIAL_PUBLISHING_ENABLED` to `true`.
7. In **Settings → Environments → production → Environment secrets**, add
   `SOCIAL_APP_PRIVATE_KEY` with the entire PEM file contents, including the
   BEGIN and END lines. Configure the social account secrets in this environment
   too; only enabled providers need credentials.

The workflow creates a fresh, short-lived, repository-scoped installation token
for each run. You do not need `SOCIAL_GITHUB_TOKEN` when using the App; it is a
fallback for a narrowly scoped access token when an App is unavailable.
Treat the PEM file as a secret: never commit it or paste it into chat.
Keep `SOCIAL_AUTO_MERGE` unset or `false` while testing. The initialisation steps
below still apply before first publication.

The GitHub token must trigger normal PR and merge CI. Do not substitute
`GITHUB_TOKEN` without accounting for its event-trigger restrictions. Never expose
publishing credentials to PR builds or the browser.

Start with a dry run after building:

```bash
pnpm build
pnpm social:dry-run
```

Inspect `social-backfill-report.json`. Historical discovery paginates the configured
authors' public posts and accepts only unique exact canonical-link matches.
Ambiguous, unmatched or inaccessible history needs review; it never creates old
announcements. Add manual URLs for posts whose announcements cannot be matched.

Before first publication, dispatch **Build and Deploy** on `main` with
`socialMode=initialise`. Review and merge the resulting historical mappings and
baseline PR. Only posts becoming eligible after this baseline are announced.
`socialMode=backfill` repeats matching without resetting the baseline;
`socialMode=dry-run` reports without writing; `publish` is the normal default.

Interrupted or rate-limited history scans produce a discovery checkpoint artifact.
Dispatch the same discovery mode with `socialResumeRun` set to the originating
main workflow run ID to continue. Checkpoints retain candidate identities across
pages, so duplicate announcements remain ambiguous; no historical mappings are
applied until the scan is complete. A changed account/catalogue requires a fresh
scan. For local dry runs, set `SOCIAL_DISCOVERY_CHECKPOINT` to the downloaded JSON
file path. Never use a cursor alone as proof that an announcement is unique.

Progress is durably recorded on `automation/social-threads` before external writes,
including record/media IDs and uncertain outcomes. Completed mappings reach the
site through a follow-up PR and deployment. Do not delete pending journal entries:
reconcile uncertain submissions before retrying, particularly Mastodon's limited
idempotency window. The two providers recover independently.

Set `SOCIAL_AUTO_MERGE=true` only after configuring enforced required checks and
token permissions in the production repository. Only mapping/state-only PRs with
completed operations are eligible. Historical changes require manual review.
Incomplete operations keep the PR in draft; unavailable checks leave it for review.

### Announcement previews on pull requests

PR builds prepare examples for every newly added post, including drafts/scheduled
posts with clear labels. A separate trusted workflow updates one bot comment with
the proposed Bluesky and Mastodon text, length warnings, and planned Mastodon image
path/alt text. To show the image itself, set the optional `previewHostSuffix` in
social configuration to your trusted Cloudflare account host, for example
`your-account.workers.dev`; only images from that host are embedded. Text uses
production URLs, not preview URLs. This workflow handles
data only, never executes downloaded PR code and has no publishing credentials.
It first becomes operational once its workflow is on the default branch.

### Preserving Disqus comments

Disqus remains enabled under its existing production gate until its export has
been imported and verified. Obtain an export, run the local importer, and review
the sanitised `src/data/legacy-comments.json` output before committing it.
Only approved public comments belong in the archive; never commit the raw export.
Static archive pages preserve timestamps/reply relationships and are excluded
from indexing and the sitemap.

```bash
pnpm social:import-disqus --export export.xml --manifest dist/social-posts.json
```

The importer requires positive approval evidence; it does not assume that every
non-spam comment is approved. For WXR exports without an approval field, supply a
reviewed JSON array of publicly approved comment IDs using
`--approved-ids reviewed-approved-ids.json`. Explicit rejection, spam or deletion
always excludes a comment, even if its ID is allowlisted. Private export fields
are never copied to the archive.

After checking the archive links and completeness, set `archiveReady: true` in the
social configuration. This removes the normal Disqus embed. Keep the switch false
until the archive is verified; the engine does not discard legacy comments for you.
