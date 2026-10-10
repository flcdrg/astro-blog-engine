import { execFileSync } from "node:child_process";
import { mappingsSchema, stateSchema, type Mappings, type PublishingState } from "../../src/scripts/social/schema.ts";

const branch = "automation/social-threads";
const paths = ["src/data/social-posts.json", "src/data/social-publishing-state.json"] as const;

export function gh<T>(path: string, method = "GET", input?: object): T {
  const args = ["api", path, "--method", method];
  if (input) args.push("--input", "-");
  return JSON.parse(execFileSync("gh", args, {
    encoding: "utf8",
    ...(input ? { input: JSON.stringify(input) } : {}),
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  })) as T;
}

export class Journal {
  private head: string | undefined;
  private previous: string | undefined;
  private repo: string;
  private main: string;
  constructor(repo: string, main: string) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[a-f0-9]{40}$/.test(main)) throw new Error("Invalid publishing repository/commit");
    this.repo = repo;
    this.main = main;
  }

  load(): { mappings: Mappings; state: PublishingState } | undefined {
    const refs = gh<Array<{ ref: string; object: { sha: string } }>>(`repos/${this.repo}/git/matching-refs/heads/${branch}`);
    this.head = refs.find((ref) => ref.ref === `refs/heads/${branch}`)?.object.sha;
    if (!this.head) return undefined;
    const files = paths.map((path) => {
      const file = gh<{ content: string }>(`repos/${this.repo}/contents/${path}?ref=${this.head}`);
      return JSON.parse(Buffer.from(file.content, "base64").toString("utf8")) as unknown;
    });
    return { mappings: mappingsSchema.parse(files[0]), state: stateSchema.parse(files[1]) };
  }

  async persist(mappings: Mappings, state: PublishingState, reviewRequired = false) {
    const contents = [mappingsSchema.parse(mappings), stateSchema.parse(state)].map((value) => JSON.stringify(value, null, 2) + "\n");
    const serialised = JSON.stringify(contents);
    if (serialised === this.previous) return;
    const mainRef = gh<{ object: { sha: string } }>(`repos/${this.repo}/git/ref/heads/main`);
    if (mainRef.object.sha !== this.main) throw new Error("Main changed after deployment; rerun using its current successful deployment");
    const incomplete = Object.values(state.operations).some((providers) => Object.values(providers).some((op) => op.status !== "complete"));
    if (incomplete || reviewRequired) {
      const open = gh<Array<{ number: number; draft: boolean }>>(`repos/${this.repo}/pulls?state=open&head=${this.repo.split("/")[0]}:${branch}&base=main`);
      for (const pr of open) {
        execFileSync("gh", ["pr", "merge", String(pr.number), "--repo", this.repo, "--disable-auto"], { stdio: "inherit" });
        if (!pr.draft) execFileSync("gh", ["pr", "ready", String(pr.number), "--repo", this.repo, "--undo"], { stdio: "inherit" });
      }
    }
    const mainCommit = gh<{ tree: { sha: string } }>(`repos/${this.repo}/git/commits/${this.main}`);
    const tree = gh<{ sha: string }>(`repos/${this.repo}/git/trees`, "POST", {
      base_tree: mainCommit.tree.sha,
      tree: paths.map((path, index) => ({ path, mode: "100644", type: "blob", content: contents[index] })),
    });
    const commit = gh<{ sha: string }>(`repos/${this.repo}/git/commits`, "POST", {
      message: "Persist social publishing progress\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>",
      tree: tree.sha,
      parents: [...new Set([this.head, this.main].filter((value): value is string => Boolean(value)))],
    });
    if (this.head) {
      gh(`repos/${this.repo}/git/refs/heads/${branch}`, "PATCH", { sha: commit.sha, force: false });
    } else {
      gh(`repos/${this.repo}/git/refs`, "POST", { ref: `refs/heads/${branch}`, sha: commit.sha });
    }
    this.head = commit.sha;
    this.previous = serialised;
  }

  openPullRequest(state: PublishingState, reviewRequired = false) {
    if (!this.head) return;
    const comparison = gh<{ files: Array<{ filename: string }> }>(`repos/${this.repo}/compare/main...${branch}`);
    if (!comparison.files.length) return;
    if (comparison.files.some((file) => !paths.some((path) => path === file.filename))) throw new Error("Automation PR contains non-mapping changes");
    const incomplete = Object.values(state.operations).some((providers) => Object.values(providers).some((op) => op.status !== "complete"));
    const open = gh<Array<{ number: number; draft: boolean; body: string; user: { login: string } }>>(`repos/${this.repo}/pulls?state=open&head=${this.repo.split("/")[0]}:${branch}&base=main`);
    const pr = open[0] ?? gh<{ number: number; draft: boolean; body: string; user: { login: string } }>(`repos/${this.repo}/pulls`, "POST", {
      title: "Associate blog posts with social discussions",
      head: branch,
      base: "main",
      draft: incomplete,
      body: `${reviewRequired ? "<!-- social-manual-review -->\n" : ""}Automated thread mappings and publishing journal. No content or code changes. Publishing progress is persisted here to prevent duplicate announcements.`,
    });
    if (reviewRequired && !pr.body.includes("<!-- social-manual-review -->")) {
      gh(`repos/${this.repo}/pulls/${pr.number}`, "PATCH", { body: `<!-- social-manual-review -->\n${pr.body}` });
    }
    if (!incomplete && pr.draft) execFileSync("gh", ["pr", "ready", String(pr.number), "--repo", this.repo], { stdio: "inherit" });
    if (process.env.SOCIAL_AUTO_MERGE !== "true" || incomplete || reviewRequired || pr.body.includes("<!-- social-manual-review -->")) {
      console.log(`Mapping PR #${pr.number} requires manual review${incomplete ? " (pending or uncertain operations)" : ""}.`);
      return;
    }
    const file = gh<{ content: string }>(`repos/${this.repo}/contents/${paths[0]}?ref=${this.head}`);
    const mappings = mappingsSchema.parse(JSON.parse(Buffer.from(file.content, "base64").toString("utf8")));
    for (const [id, providers] of Object.entries(state.operations)) {
      for (const [provider, operation] of Object.entries(providers)) {
        const mappedUrl = provider === "bluesky" ? mappings[id]?.blueskyUrl : mappings[id]?.mastodonUrl;
        if (!operation.url || operation.url !== mappedUrl) throw new Error(`Completed ${provider} operation for ${id} does not match its mapping`);
      }
    }
    const viewer = gh<{ data: { viewer: { login: string } } }>("graphql", "POST", { query: "{ viewer { login } }" });
    if (pr.user.login !== viewer.data.viewer.login) throw new Error("Automation PR was not created by this automation identity");
    const repository = gh<{ allow_auto_merge: boolean }>(`repos/${this.repo}`);
    if (!repository.allow_auto_merge) {
      console.log(`Mapping PR #${pr.number}: auto-merge withheld; repository auto-merge is disabled.`);
      return;
    }
    const rules = gh<Array<{ type: string; parameters?: { required_status_checks?: unknown[] } }>>(`repos/${this.repo}/rules/branches/main`);
    if (!rules.some((rule) => rule.type === "required_status_checks" && rule.parameters?.required_status_checks?.length)) {
      console.log(`Mapping PR #${pr.number}: auto-merge withheld; no enforced status checks.`);
      return;
    }
    execFileSync("gh", ["pr", "merge", String(pr.number), "--repo", this.repo, "--auto", "--squash"], { stdio: "inherit" });
  }
}
