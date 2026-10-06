import fs from "node:fs";
import path from "node:path";
import { getDb, REPOS_DIR, UPLOADS_DIR } from "./db";
import { cloneRepo, isGitRepo } from "./git";
import { ingestRepo, slugify } from "./ingest";
import { spawnSync } from "node:child_process";

export interface RepoRow {
  id: number;
  slug: string;
  name: string;
  source_type: "url" | "zip";
  source_url: string | null;
  local_path: string;
  ref: string;
  head_sha: string | null;
  status: string;
  commit_count: number;
  archived: number;
  error: string | null;
  created_at: number;
}

function uniqueSlug(db: ReturnType<typeof getDb>, base: string): string {
  let slug = base;
  let n = 2;
  const exists = (s: string) =>
    !!db.prepare(`SELECT 1 FROM repos WHERE slug = ?`).get(s);
  while (exists(slug)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

/** Add a repo by cloning a remote URL (full deep clone, never shallow). */
export async function addRepoFromUrl(url: string, ref = "HEAD"): Promise<number> {
  const db = getDb();
  const base = slugify(url.replace(/\/$/, ""));
  const slug = uniqueSlug(db, base);
  const localPath = path.join(REPOS_DIR, slug);

  const id = db
    .prepare(
      `INSERT INTO repos (slug, name, source_type, source_url, local_path, ref, status, created_at)
       VALUES (?, ?, 'url', ?, ?, ?, 'pending', ?)`
    )
    .run(slug, base, url, localPath, ref, Math.floor(Date.now() / 1000)).lastInsertRowid as number;

  try {
    await cloneRepo(url, localPath);
    await ingestRepo(id, localPath, ref);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(`UPDATE repos SET status = 'failed', error = ? WHERE id = ?`).run(message, id);
    throw err;
  }
  return id;
}

/** Add a repo from an uploaded zip file (path to the zip already on disk). */
export async function addRepoFromZip(zipPath: string, displayName: string, ref = "HEAD"): Promise<number> {
  const db = getDb();
  const base = slugify(displayName);
  const slug = uniqueSlug(db, base);
  const extractRoot = path.join(REPOS_DIR, slug);
  fs.mkdirSync(extractRoot, { recursive: true });

  const unzip = spawnSync("unzip", ["-q", "-o", zipPath, "-d", extractRoot]);
  if (unzip.status !== 0) {
    throw new Error(`Failed to extract zip: ${unzip.stderr?.toString().slice(0, 500)}`);
  }

  // Find the git root: either extractRoot itself, or exactly one level down
  // (common when a zip contains a single top-level folder).
  let gitRoot: string | null = null;
  if (await isGitRepo(extractRoot)) {
    gitRoot = extractRoot;
  } else {
    for (const entry of fs.readdirSync(extractRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const candidate = path.join(extractRoot, entry.name);
        if (await isGitRepo(candidate)) {
          gitRoot = candidate;
          break;
        }
      }
    }
  }
  if (!gitRoot) {
    throw new Error("No .git found in the uploaded zip. Make sure the zip includes the .git folder.");
  }

  const id = db
    .prepare(
      `INSERT INTO repos (slug, name, source_type, source_url, local_path, ref, status, created_at)
       VALUES (?, ?, 'zip', NULL, ?, ?, 'pending', ?)`
    )
    .run(slug, base, gitRoot, ref, Math.floor(Date.now() / 1000)).lastInsertRowid as number;

  try {
    await ingestRepo(id, gitRoot, ref);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(`UPDATE repos SET status = 'failed', error = ? WHERE id = ?`).run(message, id);
    throw err;
  }
  return id;
}

export function listRepos(includeArchived = false): RepoRow[] {
  const db = getDb();
  const rows = includeArchived
    ? db.prepare(`SELECT * FROM repos ORDER BY created_at DESC`).all()
    : db.prepare(`SELECT * FROM repos WHERE archived = 0 ORDER BY created_at DESC`).all();
  return rows as RepoRow[];
}

export function getRepo(id: number): RepoRow | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM repos WHERE id = ?`).get(id) as RepoRow | undefined;
}

export function archiveRepo(id: number, archived: boolean): void {
  const db = getDb();
  db.prepare(`UPDATE repos SET archived = ? WHERE id = ?`).run(archived ? 1 : 0, id);
}

export async function reanalyzeRepo(id: number, ref?: string): Promise<void> {
  const db = getDb();
  const repo = getRepo(id);
  if (!repo) throw new Error("Repo not found");
  const useRef = ref ?? repo.ref;
  if (repo.source_type === "url") {
    // Pull latest history before re-ingesting.
    spawnSync("git", ["-C", repo.local_path, "fetch", "--all"], { timeout: 10 * 60_000 });
  }
  db.prepare(`UPDATE repos SET ref = ? WHERE id = ?`).run(useRef, id);
  await ingestRepo(id, repo.local_path, useRef);
}

export function ensureUploadsDir(): string {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  return UPLOADS_DIR;
}
