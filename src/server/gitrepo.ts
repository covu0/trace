import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = () => process.env.DATA_DIR ?? path.join(process.cwd(), "data");

// Only these subcommands may run; args are passed as an array to spawn with
// shell:false, so nothing is ever interpreted by a shell. Everything that
// touches user-influenced values (URLs, ranges) is validated by callers
// against strict patterns before it gets here.
const ALLOWED = new Set(["clone", "rev-parse", "rev-list", "log", "diff-tree", "cat-file"]);

export class GitError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(message);
  }
}

export function runGit(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; maxBuffer?: number } = {},
): Promise<string> {
  const sub = args[0];
  if (!ALLOWED.has(sub)) throw new Error(`git subcommand not allowed: ${sub}`);
  const { cwd, timeoutMs = 120_000, maxBuffer = 64 * 1024 * 1024 } = opts;

  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      shell: false,
      windowsHide: true,
      // Never prompt for credentials; public repos only.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
    });
    let out = "";
    let err = "";
    let truncated = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new GitError(`git ${sub} timed out after ${timeoutMs}ms`, null, err));
    }, timeoutMs);

    child.stdout.setEncoding("utf8").on("data", (d: string) => {
      if (out.length < maxBuffer) out += d;
      else truncated = true;
    });
    child.stderr.setEncoding("utf8").on("data", (d: string) => {
      if (err.length < 64 * 1024) err += d;
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(truncated ? out : out);
      else reject(new GitError(`git ${sub} exited ${code}`, code, err));
    });
  });
}

export function cloneDir(repoId: number): string {
  return path.join(DATA_DIR(), "repos", `${repoId}.git`);
}

export async function bareClone(repoId: number, owner: string, name: string, branch: string) {
  const dir = cloneDir(repoId);
  // Idempotent: a partial clone from a crashed run is removed and redone.
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.dirname(dir), { recursive: true });
  const url = `https://github.com/${owner}/${name}.git`;
  await runGit(
    ["clone", "--bare", "--single-branch", "--branch", branch, "--", url, dir],
    { timeoutMs: 15 * 60_000 },
  );
  return dir;
}

export async function headSha(repoId: number): Promise<string> {
  return (await runGit(["rev-parse", "HEAD"], { cwd: cloneDir(repoId) })).trim();
}

export async function commitCount(repoId: number): Promise<number> {
  const out = await runGit(["rev-list", "--count", "HEAD"], { cwd: cloneDir(repoId) });
  return parseInt(out.trim(), 10);
}

export type CommitMeta = { sha: string; subject: string; body: string; author: string };

const FIELD_SEP = "\x1f";
const RECORD_SEP = "\x1e";

/** First-parent commit metadata, newest first, capped at `limit`. */
export async function logSample(repoId: number, limit: number): Promise<CommitMeta[]> {
  const out = await runGit(
    [
      "log",
      "--first-parent",
      `--max-count=${limit}`,
      `--format=%H${FIELD_SEP}%s${FIELD_SEP}%b${FIELD_SEP}%an${RECORD_SEP}`,
    ],
    { cwd: cloneDir(repoId), timeoutMs: 300_000 },
  );
  return out
    .split(RECORD_SEP)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [sha, subject, body, author] = r.split(FIELD_SEP);
      return { sha, subject: subject ?? "", body: body ?? "", author: author ?? "" };
    });
}

// Repo-relative path validation for user-supplied file paths. Conservative on
// purpose: printable, no "..", no leading "-" or "/", no control chars.
const SAFE_PATH = /^(?!\/)(?!-)[\x20-\x7E]+$/;

export function isSafeRepoPath(p: string): boolean {
  return (
    SAFE_PATH.test(p) &&
    !p.includes("..") &&
    p.length <= 500 &&
    !p.split("/").some((seg) => seg.startsWith("-"))
  );
}

export async function fileExistsAtHead(repoId: number, path: string): Promise<boolean> {
  if (!isSafeRepoPath(path)) return false;
  try {
    await runGit(["cat-file", "-e", `HEAD:${path}`], { cwd: cloneDir(repoId) });
    return true;
  } catch {
    return false;
  }
}

const BODY_END = "\x02"; // separates %b from the patch text that follows it

export type RegionCommit = {
  sha: string;
  author: string;
  date: string; // ISO 8601
  subject: string;
  body: string;
  patch: string;
};

/**
 * Line-range history via `git log -L` — the archaeology primitive. Follows
 * renames, walks first-parent, newest first. Throws GitError with git's
 * message when the range is invalid for the file.
 */
export async function regionLog(
  repoId: number,
  path: string,
  startLine: number,
  endLine: number,
): Promise<RegionCommit[]> {
  if (!isSafeRepoPath(path)) throw new Error(`unsafe path: ${path}`);
  if (
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine
  ) {
    throw new Error(`invalid line range: ${startLine},${endLine}`);
  }
  const out = await runGit(
    [
      "log",
      "--first-parent",
      `-L${startLine},${endLine}:${path}`,
      `--format=%x1e%H${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s${FIELD_SEP}%b${BODY_END}`,
    ],
    { cwd: cloneDir(repoId), timeoutMs: 300_000 },
  );
  return out
    .split("\x1e")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((record) => {
      const bodyEnd = record.indexOf(BODY_END);
      const header = bodyEnd === -1 ? record : record.slice(0, bodyEnd);
      const patch = bodyEnd === -1 ? "" : record.slice(bodyEnd + 1).trim();
      const [sha, author, date, subject, body] = header.split(FIELD_SEP);
      return {
        sha: sha ?? "",
        author: author ?? "",
        date: date ?? "",
        subject: subject ?? "",
        body: (body ?? "").trim(),
        patch,
      };
    })
    .filter((c) => /^[0-9a-f]{40}$/.test(c.sha));
}

/** Detects an "initial commit dump": history begins with one huge import commit. */
export async function rootCommitFileCount(repoId: number): Promise<number> {
  const cwd = cloneDir(repoId);
  const root = (await runGit(["rev-list", "--max-parents=0", "HEAD", "--max-count=1"], { cwd })).trim();
  if (!root) return 0;
  const out = await runGit(["diff-tree", "--no-commit-id", "--name-only", "-r", root], {
    cwd,
    timeoutMs: 300_000,
  });
  return out.split("\n").filter(Boolean).length;
}
