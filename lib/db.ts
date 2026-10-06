import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// ONE database module. The DB file lives at ./data/app.db. On first use we
// create the data folder, the file, and every table/index (CREATE TABLE IF
// NOT EXISTS) so a fresh `git clone` + `npm install` + `npm run dev` needs no
// manual setup.
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "app.db");
export const REPOS_DIR = path.join(DATA_DIR, "repos");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

let instance: Database.Database | null = null;

function createSchema(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      source_type TEXT NOT NULL,          -- 'url' | 'zip'
      source_url TEXT,
      local_path TEXT NOT NULL,
      ref TEXT NOT NULL DEFAULT 'HEAD',
      head_sha TEXT,
      status TEXT NOT NULL DEFAULT 'pending', -- pending|ingesting|ready|failed
      commit_count INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repos(id),
      sha TEXT NOT NULL,
      parent_sha TEXT,
      author_key TEXT NOT NULL,           -- "Name <email>" post-mailmap
      committer_date INTEGER NOT NULL,
      seq INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_commits_repo_sha ON commits(repo_id, sha);
    CREATE INDEX IF NOT EXISTS idx_commits_repo_date ON commits(repo_id, committer_date);
    CREATE INDEX IF NOT EXISTS idx_commits_repo_author ON commits(repo_id, author_key);

    CREATE TABLE IF NOT EXISTS changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      commit_id INTEGER NOT NULL REFERENCES commits(id),
      path TEXT NOT NULL,
      added INTEGER NOT NULL,
      removed INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_changes_commit ON changes(commit_id);
    CREATE INDEX IF NOT EXISTS idx_changes_repo_path ON changes(repo_id, path);

    CREATE TABLE IF NOT EXISTS dir_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      commit_id INTEGER NOT NULL REFERENCES commits(id),
      path TEXT NOT NULL,                 -- '' = repository root
      added INTEGER NOT NULL,
      removed INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dirchanges_commit ON dir_changes(commit_id);
    CREATE INDEX IF NOT EXISTS idx_dirchanges_repo_path ON dir_changes(repo_id, path);

    CREATE TABLE IF NOT EXISTS objects_seen (
      repo_id INTEGER NOT NULL,
      object_type TEXT NOT NULL,          -- 'file' | 'directory'
      path TEXT NOT NULL,
      PRIMARY KEY (repo_id, object_type, path)
    );

    CREATE TABLE IF NOT EXISTS authors_seen (
      repo_id INTEGER NOT NULL,
      author_key TEXT NOT NULL,
      PRIMARY KEY (repo_id, author_key)
    );

    CREATE TABLE IF NOT EXISTS author_merges (
      repo_id INTEGER NOT NULL,
      source_key TEXT NOT NULL,
      target_key TEXT NOT NULL,
      PRIMARY KEY (repo_id, source_key)
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      status TEXT NOT NULL,               -- queued|running|done|failed
      total INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_repo ON jobs(repo_id);
  `);
}

export function getDb(): Database.Database {
  if (instance) return instance;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(REPOS_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  instance = new Database(DB_PATH);
  createSchema(instance);
  return instance;
}
