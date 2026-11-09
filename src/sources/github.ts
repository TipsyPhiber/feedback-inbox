import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FeedbackItem } from "../types.js";

const run = promisify(execFile);

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  created_at: string;
  user: { login: string } | null;
  pull_request?: unknown;
}

/** GITHUB_TOKEN wins; otherwise borrow the GitHub CLI's login. Public repos also work without a token. */
export async function resolveGitHubToken(): Promise<string | undefined> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const { stdout } = await run("gh", ["auth", "token"]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export interface GitHubOptions {
  token?: string;
  /** Only issues created on or after this date. */
  since?: Date;
  fetchImpl?: typeof fetch;
}

/** Open and closed issues (not pull requests) from one repo, oldest first. */
export async function feedbackFromGitHub(repo: string, opts: GitHubOptions = {}): Promise<FeedbackItem[]> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`Repo must look like owner/name, got "${repo}"`);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "feedback-inbox",
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const items: FeedbackItem[] = [];
  for (let page = 1; ; page++) {
    const url = new URL(`https://api.github.com/repos/${repo}/issues`);
    url.searchParams.set("state", "all");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "created");
    url.searchParams.set("direction", "asc");
    if (opts.since) url.searchParams.set("since", opts.since.toISOString());

    const res = await fetchImpl(url, { headers });
    if (!res.ok) {
      throw new Error(`GitHub ${res.status} for ${repo}: ${(await res.text()).slice(0, 200)}`);
    }
    const batch = (await res.json()) as GitHubIssue[];
    for (const issue of batch) {
      if (issue.pull_request) continue; // the issues endpoint also returns PRs
      if (opts.since && new Date(issue.created_at) < opts.since) continue; // `since` filters by update time
      items.push({
        externalId: `github:${repo}#${issue.number}`,
        title: issue.title,
        body: issue.body?.trim() || issue.title,
        author: issue.user?.login ?? "ghost",
        source: "GitHub",
        url: issue.html_url,
        createdAt: issue.created_at,
      });
    }
    if (batch.length < 100) break;
  }
  return items;
}
