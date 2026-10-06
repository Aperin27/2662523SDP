import { spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// Thin wrappers around the system git CLI. We never reimplement git — all
// history/diff/rename/binary/mailmap semantics come straight from git itself.
// Verified formats (see exam spike): %aN/%aE is the mailmap-resolved author,
// a root commit has an empty %P, pure renames are "0\t0\told => new", a
// rename+edit is "N\t0\told => new" (counted at the NEW path), a deletion is
// "0\tN\tpath", and a binary file is "-\t-\tpath" (never measured).
// ---------------------------------------------------------------------------

const COMMIT_MARKER = "\u0001COMMIT\u0001";
// %H sha | %aN mailmap name | %aE mailmap email | %ct committer date | %P parents
const LOG_FORMAT = `${COMMIT_MARKER}%H\u0002%aN\u0002%aE\u0002%ct\u0002%P`;

export interface RawCommit {
  sha: string;
  authorName: string;
  authorEmail: string;
  committerDate: number; // unix seconds
  parents: string[];
  /** path -> {added, removed}; binary and 0/0 changes are omitted */
  changes: Map<string, { added: number; removed: number }>;
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; onLine?: (line: string) => void; timeoutMs?: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    let stderr = "";
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`git command timed out: ${cmd} ${args.join(" ")}`));
        }, opts.timeoutMs)
      : null;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (opts.onLine) {
        buf += chunk;
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          opts.onLine(buf.slice(0, idx));
          buf = buf.slice(idx + 1);
        }
      } else {
        buf += chunk;
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (opts.onLine && buf.length) opts.onLine(buf);
      if (code !== 0) {
        reject(new Error(`${cmd} ${args.join(" ")} failed (${code}): ${stderr.slice(0, 2000)}`));
      } else {
        resolve(buf);
      }
    });
  });
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await run("git", ["rev-parse", "--git-dir"], { cwd: dir, timeoutMs: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export async function resolveRef(dir: string, ref: string): Promise<string> {
  const out = await run("git", ["rev-parse", ref], { cwd: dir, timeoutMs: 10_000 });
  return out.trim();
}

export async function countNonMergeCommits(dir: string, ref: string): Promise<number> {
  const out = await run("git", ["rev-list", "--no-merges", "--count", ref], {
    cwd: dir,
    timeoutMs: 30_000,
  });
  return parseInt(out.trim(), 10) || 0;
}

export async function cloneRepo(url: string, destDir: string): Promise<void> {
  await run("git", ["clone", "--no-single-branch", url, destDir], {
    cwd: process.cwd(),
    timeoutMs: 15 * 60_000,
  });
}

/**
 * Parse one numstat line into [added, removed, path] | null (binary/blank).
 * Handles both plain paths and rename lines ("old => new" or
 * "prefix{old => new}suffix" for in-place renames git sometimes emits).
 */
function parseNumstatLine(line: string): { added: number; removed: number; path: string } | null {
  const m = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/);
  if (!m) return null;
  const [, a, r, rawPath] = m;
  if (a === "-" || r === "-") return null; // binary — never measured
  const added = parseInt(a, 10);
  const removed = parseInt(r, 10);
  let p = rawPath;
  const braceMatch = p.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braceMatch) {
    const [, pre, , newMid, post] = braceMatch;
    p = `${pre}${newMid}${post}`;
  } else if (p.includes(" => ")) {
    const parts = p.split(" => ");
    p = parts[parts.length - 1];
  }
  return { added, removed, path: p };
}

/**
 * Stream non-merge commits reachable from `ref`, oldest-affecting-info first
 * is NOT guaranteed; we take git log's default (newest first) and assign a
 * sequence number. Rename detection fixed at 50%. Calls `onCommit` for every
 * parsed commit so callers can batch-insert without holding all of history
 * in memory for huge repos.
 */
export async function streamLog(
  dir: string,
  ref: string,
  onCommit: (c: RawCommit) => void
): Promise<void> {
  let current: RawCommit | null = null;

  const flush = () => {
    if (current) onCommit(current);
    current = null;
  };

  await run(
    "git",
    [
      "-c",
      "core.quotepath=false",
      "log",
      ref,
      "--no-merges",
      "--use-mailmap",
      `--format=${LOG_FORMAT}`,
      "--numstat",
      "-M50%",
    ],
    {
      cwd: dir,
      timeoutMs: 60 * 60_000,
      onLine: (line) => {
        if (line.startsWith(COMMIT_MARKER)) {
          flush();
          const rest = line.slice(COMMIT_MARKER.length);
          const [sha, authorName, authorEmail, ctStr, parentsStr] = rest.split("\u0002");
          current = {
            sha,
            authorName,
            authorEmail,
            committerDate: parseInt(ctStr, 10),
            parents: parentsStr ? parentsStr.trim().split(" ").filter(Boolean) : [],
            changes: new Map(),
          };
          return;
        }
        if (!line.trim()) return;
        if (!current) return;
        const parsed = parseNumstatLine(line);
        if (!parsed) return; // binary file — skip entirely
        if (parsed.added === 0 && parsed.removed === 0) return; // pure rename, no net effect
        const existing = current.changes.get(parsed.path);
        if (existing) {
          existing.added += parsed.added;
          existing.removed += parsed.removed;
        } else {
          current.changes.set(parsed.path, { added: parsed.added, removed: parsed.removed });
        }
      },
    }
  );
  flush();
}
