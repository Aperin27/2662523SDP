/*
 * Usage: npx tsx scripts/add-local.ts <slug> <localPath> <ref>
 * Registers an already-cloned local git repo (no network clone) and ingests it.
 * Handy for testing against repo-references/ without re-cloning cJSON/redis/git each time.
 */
import { getDb } from "../lib/db";
import { ingestRepo } from "../lib/ingest";

async function main() {
  const [slug, localPath, ref] = process.argv.slice(2);
  if (!slug || !localPath || !ref) {
    console.error("Usage: tsx scripts/add-local.ts <slug> <localPath> <ref>");
    process.exit(2);
  }
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM repos WHERE slug = ?`).get(slug) as
    | { id: number }
    | undefined;
  let id: number;
  if (existing) {
    id = existing.id;
    console.log(`Reusing existing repo id=${id} slug=${slug}`);
  } else {
    id = db
      .prepare(
        `INSERT INTO repos (slug, name, source_type, source_url, local_path, ref, status, created_at)
         VALUES (?, ?, 'url', NULL, ?, ?, 'pending', ?)`
      )
      .run(slug, slug, localPath, ref, Math.floor(Date.now() / 1000)).lastInsertRowid as number;
    console.log(`Created repo id=${id} slug=${slug}`);
  }

  const t0 = Date.now();
  await ingestRepo(id, localPath, ref);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const repo = db.prepare(`SELECT * FROM repos WHERE id = ?`).get(id);
  console.log(`Ingest finished in ${secs}s:`, repo);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
