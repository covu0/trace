const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function gh<T>(token: string, path: string): Promise<{ data: T; linkNext: boolean }> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      // Empty token → unauthenticated (60 req/hr) — used by the CLI harness.
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    // GitHub API responses must never be cached across users.
    cache: "no-store",
  });
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
    const waitMin = Math.max(1, Math.round((reset - Date.now()) / 60_000));
    throw new GitHubError(`GitHub rate limit exceeded; resets in ~${waitMin} min`, 429);
  }
  if (!res.ok) {
    throw new GitHubError(`GitHub API ${res.status} for ${path}`, res.status);
  }
  const linkNext = /rel="next"/.test(res.headers.get("link") ?? "");
  return { data: (await res.json()) as T, linkNext };
}

export type RepoInfo = {
  owner: string;
  name: string;
  private: boolean;
  fork: boolean;
  sizeKb: number;
  defaultBranch: string;
};

export async function getRepo(token: string, owner: string, name: string): Promise<RepoInfo> {
  type R = {
    name: string;
    owner: { login: string };
    private: boolean;
    fork: boolean;
    size: number;
    default_branch: string;
  };
  const { data } = await gh<R>(token, `/repos/${owner}/${name}`);
  return {
    owner: data.owner.login,
    name: data.name,
    private: data.private,
    fork: data.fork,
    sizeKb: data.size,
    defaultBranch: data.default_branch,
  };
}

export type IssueInfo = {
  number: number;
  title: string;
  body: string | null;
  isPull: boolean;
};

/** Fetch a single issue (or PR — GitHub shares the number space). Null on 404. */
export async function getIssue(
  token: string,
  owner: string,
  name: string,
  number: number,
): Promise<IssueInfo | null> {
  type I = { number: number; title: string; body: string | null; pull_request?: unknown };
  try {
    const { data } = await gh<I>(token, `/repos/${owner}/${name}/issues/${number}`);
    return {
      number: data.number,
      title: data.title,
      body: data.body,
      isPull: data.pull_request !== undefined,
    };
  } catch (err) {
    if (err instanceof GitHubError && (err.status === 404 || err.status === 410)) return null;
    throw err;
  }
}

export type MergedPr = {
  number: number;
  title: string;
  body: string | null;
  author: string | null;
  mergedAt: string;
  mergeCommitSha: string | null;
  headSha: string | null;
};

/**
 * One page (100) of closed PRs, filtered to merged ones.
 * `page` is 1-based; `done` is true when GitHub reports no next page.
 */
export async function listMergedPrsPage(
  token: string,
  owner: string,
  name: string,
  page: number,
): Promise<{ prs: MergedPr[]; done: boolean }> {
  type P = {
    number: number;
    title: string;
    body: string | null;
    user: { login: string } | null;
    merged_at: string | null;
    merge_commit_sha: string | null;
    head: { sha: string } | null;
  };
  const { data, linkNext } = await gh<P[]>(
    token,
    `/repos/${owner}/${name}/pulls?state=closed&sort=created&direction=desc&per_page=100&page=${page}`,
  );
  const prs = data
    .filter((p) => p.merged_at !== null)
    .map((p) => ({
      number: p.number,
      title: p.title,
      body: p.body,
      author: p.user?.login ?? null,
      mergedAt: p.merged_at as string,
      mergeCommitSha: p.merge_commit_sha,
      headSha: p.head?.sha ?? null,
    }));
  return { prs, done: !linkNext };
}
