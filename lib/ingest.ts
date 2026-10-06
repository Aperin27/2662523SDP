import path from "node:path";
import { getDb } from "./db";
import { countNonMergeCommits, resolveRef, streamLog, type RawCommit } from "./git";

const BATCH_SIZE = 2000;

/** All ancestor directory paths of a file path, including the root ('' ). */
function ancestorDirs(filePath: string): string[] {
  const dirs: string[] = [""];
  const parts = filePath.split("/");
  let acc = "";
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i];
    dirs.push(acc);
  }
  return dirs;
}

function parentDir(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? "" : p.slice(0, idx);
}

export async function ingestRepo(repoId: number, localPath: string, ref: string): Promise<void> {
  const db = getDb();
  const now = () => Math.floor(Date.now() / 1000);

  const jobInsert = db.prepare(
    `INSERT INTO jobs (repo_id, status, total, done, created_at, updated_at) VALUES (?, 'running', 0, 0, ?, ?)`
  );
  const jobId = jobInsert.run(repoId, now(), now()).lastInsertRowid as number;

  db.prepare(`UPDATE repos SET status = 'ingesting', error = NULL WHERE id = ?`).run(repoId);

  try {
    const headSha = await resolveRef(localPath, ref);
    const total = await countNonMergeCommits(localPath, headSha);
    db.prepare(`UPDATE jobs SET total = ? WHERE id = ?`).run(total, jobId);

    // Wipe any previous ingest for this repo (re-analyze support).
    db.prepare(`DELETE FROM dir_changes WHERE repo_id = ?`).run(repoId);
    db.prepare(`DELETE FROM changes WHERE repo_id = ?`).run(repoId);
    db.prepare(`DELETE FROM commits WHERE repo_id = ?`).run(repoId);
    db.prepare(`DELETE FROM objects_seen WHERE repo_id = ?`).run(repoId);
    db.prepare(`DELETE FROM authors_seen WHERE repo_id = ?`).run(repoId);

    const insCommit = db.prepare(
      `INSERT INTO commits (repo_id, sha, parent_sha, author_key, committer_date, seq) VALUES (?, ?, ?, ?, ?, ?)`
    );
    const insChange = db.prepare(
      `INSERT INTO changes (repo_id, commit_id, path, added, removed) VALUES (?, ?, ?, ?, ?)`
    );
    const insDirChange = db.prepare(
      `INSERT INTO dir_changes (repo_id, commit_id, path, added, removed) VALUES (?, ?, ?, ?, ?)`
    );
    const insObject = db.prepare(
      `INSERT OR IGNORE INTO objects_seen (repo_id, object_type, path) VALUES (?, ?, ?)`
    );
    const insAuthor = db.prepare(
      `INSERT OR IGNORE INTO authors_seen (repo_id, author_key) VALUES (?, ?)`
    );
    const updJob = db.prepare(`UPDATE jobs SET done = ?, updated_at = ? WHERE id = ?`);

    let seq = 0;
    let done = 0;
    let batch: RawCommit[] = [];

    const flushBatch = db.transaction((commits: RawCommit[]) => {
      for (const c of commits) {
        const authorKey = `${c.authorName} <${c.authorEmail}>`;
        const parentSha = c.parents.length > 0 ? c.parents[0] : null;
        const commitId = insCommit.run(
          repoId,
          c.sha,
          parentSha,
          authorKey,
          c.committerDate,
          seq++
        ).lastInsertRowid as number;
        insAuthor.run(repoId, authorKey);

        // Directory rollups: aggregate added/removed per ancestor dir for this commit.
        const dirTotals = new Map<string, { added: number; removed: number }>();
        for (const [filePath, delta] of c.changes) {
          insChange.run(repoId, commitId, filePath, delta.added, delta.removed);
          insObject.run(repoId, "file", filePath);
          insObject.run(repoId, "directory", parentDir(filePath));
          for (const dir of ancestorDirs(filePath)) {
            const t = dirTotals.get(dir);
            if (t) {
              t.added += delta.added;
              t.removed += delta.removed;
            } else {
              dirTotals.set(dir, { added: delta.added, removed: delta.removed });
            }
            if (dir !== "") insObject.run(repoId, "directory", dir);
          }
        }
        for (const [dir, totals] of dirTotals) {
          insDirChange.run(repoId, commitId, dir, totals.added, totals.removed);
        }
      }
    });

    await streamLog(localPath, headSha, (commit) => {
      batch.push(commit);
      done++;
      if (batch.length >= BATCH_SIZE) {
        flushBatch(batch);
        batch = [];
        updJob.run(done, now(), jobId);
      }
    });
    if (batch.length > 0) {
      flushBatch(batch);
    }

    db.prepare(`UPDATE jobs SET status = 'done', done = ?, updated_at = ? WHERE id = ?`).run(
      done,
      now(),
      jobId
    );
    db.prepare(
      `UPDATE repos SET status = 'ready', head_sha = ?, commit_count = ?, error = NULL WHERE id = ?`
    ).run(headSha, done, repoId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(`UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).run(
      message,
      now(),
      jobId
    );
    db.prepare(`UPDATE repos SET status = 'failed', error = ? WHERE id = ?`).run(message, repoId);
    throw err;
  }
}

export function slugify(name: string): string {
  return (
    path
      .basename(name)
      .replace(/\.git$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "repo"
  );
}
