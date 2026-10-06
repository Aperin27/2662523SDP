/*
 * Usage: npx tsx scripts/compare.ts <repoSlugOrId> <csvPath>
 *
 * Re-uses lib/metrics.ts (same code the UI/API call) to compute every
 * (object_type, path, author) row and diffs it against the grader-provided
 * sample CSV. Exits non-zero on any mismatch.
 */
import fs from "node:fs";
import { getDb } from "../lib/db";
import { getObjectMetrics, type CommitSetSpec } from "../lib/metrics";
import { getRepo, listRepos } from "../lib/repos";

interface CsvRow {
  object_type: string;
  path: string;
  author: string;
  added: string;
  removed: string;
  growth: string;
  churn: string;
  modifications: string;
  modification_frequency: string;
  churn_rate: string;
  ownership: string;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0].split(",");
  const idx = (name: string) => header.indexOf(name);
  const out: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    // simple CSV split (no quoted commas expected in this dataset's columns we use)
    const cols = lines[i].split(",");
    out.push({
      object_type: cols[idx("object_type")],
      path: cols[idx("path")],
      author: cols[idx("author")],
      added: cols[idx("added")],
      removed: cols[idx("removed")],
      growth: cols[idx("growth")],
      churn: cols[idx("churn")],
      modifications: cols[idx("modifications")],
      modification_frequency: cols[idx("modification_frequency")],
      churn_rate: cols[idx("churn_rate")],
      ownership: cols[idx("ownership")],
    });
  }
  return out;
}

function approxEq(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

function toNum(s: string): number | null {
  if (s === undefined || s === "") return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

async function main() {
  const [repoArg, csvPath] = process.argv.slice(2);
  if (!repoArg || !csvPath) {
    console.error("Usage: tsx scripts/compare.ts <repoSlugOrId> <csvPath>");
    process.exit(2);
  }
  const db = getDb();
  const repos = listRepos(true);
  const repo =
    repos.find((r) => r.slug === repoArg) ?? getRepo(Number(repoArg));
  if (!repo) {
    console.error(`Repo not found: ${repoArg}. Known: ${repos.map((r) => r.slug).join(", ")}`);
    process.exit(2);
  }

  const csvText = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(csvText);
  console.log(`Loaded ${rows.length} expected rows from ${csvPath}`);

  // Normalize object key: (object_type, path). CSV uses '/' for repository root.
  const grouped = new Map<string, CsvRow[]>();
  for (const r of rows) {
    const key = `${r.object_type}\u0000${r.path}`;
    const arr = grouped.get(key);
    if (arr) arr.push(r);
    else grouped.set(key, [r]);
  }

  const spec: CommitSetSpec = { kind: "all" };
  let matched = 0;
  let mismatches: string[] = [];
  let checkedObjects = 0;

  for (const [key, expectedRows] of grouped) {
    const [objectType, path] = key.split("\u0000");
    const ourPath = objectType === "repository" ? "" : path;
    const result = getObjectMetrics(
      repo.id,
      objectType as "repository" | "directory" | "file",
      ourPath,
      spec
    );
    checkedObjects++;

    for (const er of expectedRows) {
      const isAllRow = er.author === "ALL";
      if (isAllRow) {
        const checks: [string, number | null, number][] = [
          ["added", toNum(er.added), result.all.added],
          ["removed", toNum(er.removed), result.all.removed],
          ["growth", toNum(er.growth), result.all.growth],
          ["churn", toNum(er.churn), result.all.churn],
          ["modifications", toNum(er.modifications), result.all.modifications],
          ["modification_frequency", toNum(er.modification_frequency), result.all.modificationFrequency],
          ["churn_rate", toNum(er.churn_rate), result.all.churnRate],
        ];
        for (const [field, expected, actual] of checks) {
          if (expected === null) continue;
          if (!approxEq(expected, actual)) {
            mismatches.push(
              `${objectType} "${path}" ALL.${field}: expected ${expected}, got ${actual}`
            );
          } else {
            matched++;
          }
        }
      } else {
        const ours = result.byAuthor.find((a) => a.author === er.author);
        if (!ours) {
          mismatches.push(`${objectType} "${path}" author "${er.author}": MISSING in our output`);
          continue;
        }
        const checks: [string, number | null, number][] = [
          ["added", toNum(er.added), ours.added],
          ["removed", toNum(er.removed), ours.removed],
          ["growth", toNum(er.growth), ours.growth],
          ["churn", toNum(er.churn), ours.churn],
          ["modifications", toNum(er.modifications), ours.modifications],
          ["ownership", toNum(er.ownership), ours.ownership],
        ];
        for (const [field, expected, actual] of checks) {
          if (expected === null) continue;
          if (!approxEq(expected, actual)) {
            mismatches.push(
              `${objectType} "${path}" author "${er.author}".${field}: expected ${expected}, got ${actual}`
            );
          } else {
            matched++;
          }
        }
      }
    }
  }

  console.log(`Checked ${checkedObjects} objects, ${matched} field-matches, ${mismatches.length} mismatches.`);
  if (mismatches.length > 0) {
    console.log("\nFirst 30 mismatches:");
    for (const m of mismatches.slice(0, 30)) console.log(" - " + m);
    process.exit(1);
  } else {
    console.log("All checked fields match the sample CSV.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
