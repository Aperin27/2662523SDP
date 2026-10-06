import type Database from "better-sqlite3";
import { getDb } from "./db";

// ---------------------------------------------------------------------------
// All metrics are plain SQL aggregations over the ingested cache. This file
// is the single source of truth: the dashboard, the API routes and the CSV
// export/comparator all call these functions — never two implementations.
// ---------------------------------------------------------------------------

export type CommitSetSpec =
  | { kind: "all" }
  | { kind: "range"; from?: number; to?: number } // ct >= from && ct < to
  | { kind: "manual"; shas: string[] };

export interface AuthorMetricRow {
  author: string;
  added: number;
  removed: number;
  growth: number;
  churn: number;
  modifications: number;
  ownership: number;
}

export interface AllMetricRow {
  added: number;
  removed: number;
  growth: number;
  churn: number;
  modifications: number;
  modificationFrequency: number;
  churnRate: number;
}

export interface ObjectMetrics {
  objectType: "repository" | "directory" | "file";
  path: string;
  all: AllMetricRow;
  byAuthor: AuthorMetricRow[];
}

/** Canonical author SQL expression resolving manual merges (one hop, flattened on write). */
function authorExpr(repoId: number): string {
  return `COALESCE((SELECT target_key FROM author_merges am WHERE am.repo_id = ${repoId} AND am.source_key = cm.author_key), cm.author_key)`;
}

/** Build the SQL condition (+ params) restricting commits ("cm" alias) to the given set. */
function commitSetWhere(spec: CommitSetSpec): { sql: string; params: unknown[] } {
  if (spec.kind === "all") return { sql: "1=1", params: [] };
  if (spec.kind === "range") {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (spec.from !== undefined) {
      clauses.push("cm.committer_date >= ?");
      params.push(spec.from);
    }
    if (spec.to !== undefined) {
      clauses.push("cm.committer_date < ?");
      params.push(spec.to);
    }
    return { sql: clauses.length ? clauses.join(" AND ") : "1=1", params };
  }
  // manual
  if (spec.shas.length === 0) return { sql: "0=1", params: [] };
  const placeholders = spec.shas.map(() => "?").join(",");
  return { sql: `cm.sha IN (${placeholders})`, params: [...spec.shas] };
}

export function commitSetCount(db: Database.Database, repoId: number, spec: CommitSetSpec): number {
  const { sql, params } = commitSetWhere(spec);
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM commits cm WHERE cm.repo_id = ? AND ${sql}`)
    .get(repoId, ...params) as { n: number };
  return row.n;
}

function tableForType(objectType: "directory" | "file" | "repository"): string {
  return objectType === "file" ? "changes" : "dir_changes";
}

/**
 * Metrics for a single object (file/directory/repository) across a commit
 * set: the ALL aggregate plus one row per (canonical) author, sorted by
 * ownership descending — matching the convention of the sample CSVs.
 */
export function getObjectMetrics(
  repoId: number,
  objectType: "repository" | "directory" | "file",
  objPath: string,
  spec: CommitSetSpec
): ObjectMetrics {
  const db = getDb();
  const table = tableForType(objectType);
  const dirPath = objectType === "repository" ? "" : objPath;
  const { sql: setSql, params: setParams } = commitSetWhere(spec);
  const H = commitSetCount(db, repoId, spec);

  const allRow = db
    .prepare(
      `SELECT COALESCE(SUM(t.added),0) AS added, COALESCE(SUM(t.removed),0) AS removed,
              COUNT(DISTINCT CASE WHEN (t.added + t.removed) > 0 THEN cm.id END) AS modifications
       FROM ${table} t JOIN commits cm ON cm.id = t.commit_id
       WHERE t.repo_id = ? AND t.path = ? AND ${setSql}`
    )
    .get(repoId, dirPath, ...setParams) as { added: number; removed: number; modifications: number };

  const growth = allRow.added - allRow.removed;
  const churn = allRow.added + allRow.removed;

  const authorRows = db
    .prepare(
      `SELECT ${authorExpr(repoId)} AS author,
              SUM(t.added) AS added, SUM(t.removed) AS removed,
              COUNT(DISTINCT CASE WHEN (t.added + t.removed) > 0 THEN cm.id END) AS modifications
       FROM ${table} t JOIN commits cm ON cm.id = t.commit_id
       WHERE t.repo_id = ? AND t.path = ? AND ${setSql}
       GROUP BY author`
    )
    .all(repoId, dirPath, ...setParams) as {
    author: string;
    added: number;
    removed: number;
    modifications: number;
  }[];

  const byAuthor: AuthorMetricRow[] = authorRows
    .map((r) => {
      const aGrowth = r.added - r.removed;
      const aChurn = r.added + r.removed;
      return {
        author: r.author,
        added: r.added,
        removed: r.removed,
        growth: aGrowth,
        churn: aChurn,
        modifications: r.modifications,
        ownership: churn !== 0 ? aChurn / churn : 0,
      };
    })
    .sort((a, b) => b.ownership - a.ownership);

  return {
    objectType,
    path: objectType === "repository" ? "/" : objPath,
    all: {
      added: allRow.added,
      removed: allRow.removed,
      growth,
      churn,
      modifications: allRow.modifications,
      modificationFrequency: H !== 0 ? allRow.modifications / H : 0,
      churnRate: H !== 0 ? churn / H : 0,
    },
    byAuthor,
  };
}

export interface ObjectListRow {
  path: string;
  added: number;
  removed: number;
  growth: number;
  churn: number;
  modifications: number;
  modificationFrequency: number;
  churnRate: number;
}

/**
 * List immediate children objects (files + subdirectories) of `parentPath`
 * with their ALL-authors metrics over the given commit set, for dashboard
 * tables. parentPath '' = root.
 */
export function listChildren(
  repoId: number,
  parentPath: string,
  spec: CommitSetSpec
): { files: ObjectListRow[]; directories: ObjectListRow[] } {
  const db = getDb();
  const { sql: setSql, params: setParams } = commitSetWhere(spec);
  const H = commitSetCount(db, repoId, spec);

  function immediateChildrenOfType(objectType: "file" | "directory"): string[] {
    const rows = db
      .prepare(
        `SELECT path FROM objects_seen WHERE repo_id = ? AND object_type = ?`
      )
      .all(repoId, objectType) as { path: string }[];
    return rows
      .map((r) => r.path)
      .filter((p) => {
        const parent = p.lastIndexOf("/") === -1 ? "" : p.slice(0, p.lastIndexOf("/"));
        return parent === parentPath && p !== parentPath;
      });
  }

  function metricsFor(objectType: "file" | "directory", paths: string[]): ObjectListRow[] {
    const table = tableForType(objectType);
    return paths.map((p) => {
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(t.added),0) AS added, COALESCE(SUM(t.removed),0) AS removed,
                  COUNT(DISTINCT CASE WHEN (t.added + t.removed) > 0 THEN cm.id END) AS modifications
           FROM ${table} t JOIN commits cm ON cm.id = t.commit_id
           WHERE t.repo_id = ? AND t.path = ? AND ${setSql}`
        )
        .get(repoId, p, ...setParams) as { added: number; removed: number; modifications: number };
      const growth = row.added - row.removed;
      const churn = row.added + row.removed;
      return {
        path: p,
        added: row.added,
        removed: row.removed,
        growth,
        churn,
        modifications: row.modifications,
        modificationFrequency: H !== 0 ? row.modifications / H : 0,
        churnRate: H !== 0 ? churn / H : 0,
      };
    });
  }

  const filePaths = immediateChildrenOfType("file");
  const dirPaths = immediateChildrenOfType("directory");
  return {
    files: metricsFor("file", filePaths),
    directories: metricsFor("directory", dirPaths),
  };
}

export function listAuthors(repoId: number): string[] {
  const db = getDb();
  const merged = new Set<string>();
  const rows = db
    .prepare(
      `SELECT ${authorExpr(repoId)} AS author FROM commits cm WHERE cm.repo_id = ? GROUP BY author`
    )
    .all(repoId) as { author: string }[];
  rows.forEach((r) => merged.add(r.author));
  return Array.from(merged).sort();
}

export function mergeAuthors(repoId: number, sourceKey: string, targetKey: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    // Flatten: anything currently pointing at sourceKey now points at targetKey.
    db.prepare(
      `UPDATE author_merges SET target_key = ? WHERE repo_id = ? AND target_key = ?`
    ).run(targetKey, repoId, sourceKey);
    db.prepare(
      `INSERT INTO author_merges (repo_id, source_key, target_key) VALUES (?, ?, ?)
       ON CONFLICT(repo_id, source_key) DO UPDATE SET target_key = excluded.target_key`
    ).run(repoId, sourceKey, targetKey);
  });
  tx();
}

/** Every object (repository + every directory + every file) for CSV export. */
export function listAllObjects(repoId: number): { objectType: "repository" | "directory" | "file"; path: string }[] {
  const db = getDb();
  const dirs = db
    .prepare(`SELECT path FROM objects_seen WHERE repo_id = ? AND object_type = 'directory' ORDER BY path`)
    .all(repoId) as { path: string }[];
  const files = db
    .prepare(`SELECT path FROM objects_seen WHERE repo_id = ? AND object_type = 'file' ORDER BY path`)
    .all(repoId) as { path: string }[];
  return [
    { objectType: "repository" as const, path: "" },
    ...dirs.map((d) => ({ objectType: "directory" as const, path: d.path })),
    ...files.map((f) => ({ objectType: "file" as const, path: f.path })),
  ];
}
