/*
 * Synthetic correctness tests, independent of the sample CSVs. Covers the
 * tricky semantics the brief calls out explicitly: root commit, modify,
 * delete, pure rename (churn 0), rename+edit, binary file (excluded),
 * merge commit (excluded), mailmap merging two emails, manual author merge,
 * commit-set time-range boundaries, manual commit-set list, directory
 * rollups to root, eta/rho/ownership, and the |H|=0 zero-guard.
 *
 * Usage: npx tsx scripts/selftest.ts
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "../lib/db";
import {
  commitSetCount,
  getObjectMetrics,
  mergeAuthors,
  type CommitSetSpec,
} from "../lib/metrics";
import { ingestRepo } from "../lib/ingest";

let failures = 0;
function assertEq(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

function sh(cmd: string, cwd: string, env: Record<string, string> = {}) {
  execSync(cmd, { cwd, env: { ...process.env, ...env }, stdio: "pipe" });
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rat-selftest-"));
  sh("git init -q", dir);
  sh('git config user.name "Alice A"', dir);
  sh('git config user.email "alice@example.com"', dir);

  // Explicit "+0000" offsets so git's parsed instant matches our JS "Z" (UTC)
  // parsing regardless of the machine's local timezone (e.g. SAST/+0200).
  const dates = [
    "2024-01-01T10:00:00 +0000",
    "2024-01-02T10:00:00 +0000",
    "2024-01-03T10:00:00 +0000",
    "2024-01-04T10:00:00 +0000",
    "2024-01-05T10:00:00 +0000",
    "2024-01-06T10:00:00 +0000",
    "2024-01-07T10:00:00 +0000",
    "2024-01-08T10:00:00 +0000",
    "2024-01-09T10:00:00 +0000",
    "2024-01-10T10:00:00 +0000",
  ];
  const dateEnv = (i: number) => ({
    GIT_AUTHOR_DATE: dates[i],
    GIT_COMMITTER_DATE: dates[i],
  });

  // 0: root commit — 3 lines added
  fs.writeFileSync(path.join(dir, "a.txt"), "line1\nline2\nline3\n");
  sh("git add a.txt", dir);
  sh('git commit -q -m "root"', dir, dateEnv(0));

  // 1: modify a.txt — net +3/-1
  fs.writeFileSync(path.join(dir, "a.txt"), "line1\nlineX\nlineY\nline3\nline4\n");
  sh('git commit -aq -m "modify"', dir, dateEnv(1));

  // 2: add b.txt — +2
  fs.writeFileSync(path.join(dir, "b.txt"), "to be deleted\nline2\n");
  sh("git add b.txt", dir);
  sh('git commit -q -m "add b"', dir, dateEnv(2));

  // 3: delete b.txt — -2
  sh("git rm -q b.txt", dir);
  sh('git commit -q -m "delete b"', dir, dateEnv(3));

  // 4: pure rename a.txt -> c.txt — 0/0
  sh("git mv a.txt c.txt", dir);
  sh('git commit -q -m "rename a->c"', dir, dateEnv(4));

  // 5: rename+edit c.txt -> d.txt — +1 at new path
  sh("git mv c.txt d.txt", dir);
  fs.appendFileSync(path.join(dir, "d.txt"), "extra line\n");
  sh('git commit -aq -m "rename+edit c->d"', dir, dateEnv(5));

  // 6: binary file add — must be skipped entirely
  fs.writeFileSync(path.join(dir, "img.bin"), Buffer.from([0, 1, 2, 0, 3]));
  sh("git add img.bin", dir);
  sh('git commit -q -m "binary"', dir, dateEnv(6));

  // 7: mailmap + commit under alt email for the same person
  fs.writeFileSync(
    path.join(dir, ".mailmap"),
    "Alice A <alice@example.com> Alice A <alice.alt@example.com>\n"
  );
  sh("git add .mailmap", dir);
  sh('git commit -q -m "mailmap"', dir, {
    ...dateEnv(7),
    GIT_AUTHOR_EMAIL: "alice.alt@example.com",
    GIT_AUTHOR_NAME: "Alice A",
    GIT_COMMITTER_EMAIL: "alice.alt@example.com",
    GIT_COMMITTER_NAME: "Alice A",
  });

  // 8: a commit by a second author, under a subdirectory, to test rollups + merges
  fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
  fs.writeFileSync(path.join(dir, "sub", "e.txt"), "one\ntwo\n");
  sh("git add sub/e.txt", dir);
  sh('git -c user.name="Bob B" -c user.email="bob@example.com" commit -q -m "bob adds sub/e.txt"', dir, dateEnv(8));

  // 9: merge commit — must be excluded entirely from H
  sh("git checkout -q -b feature HEAD~2", dir);
  fs.appendFileSync(path.join(dir, "d.txt"), "feature line\n");
  sh("git add -A", dir);
  sh('git commit -q -m "feature commit"', dir, dateEnv(9));
  sh("git checkout -q master", dir);
  try {
    sh('git merge -q feature -m "merge" --no-ff -X ours', dir, dateEnv(9));
  } catch {
    sh("git merge --abort || true", dir);
    sh('git merge -q feature -m "merge" --no-ff -X ours', dir, dateEnv(9));
  }

  // Ingest.
  const db = getDb();
  const slug = "selftest-" + Date.now();
  const id = db
    .prepare(
      `INSERT INTO repos (slug, name, source_type, source_url, local_path, ref, status, created_at)
       VALUES (?, ?, 'url', NULL, ?, 'master', 'pending', ?)`
    )
    .run(slug, slug, dir, Math.floor(Date.now() / 1000)).lastInsertRowid as number;
  await ingestRepo(id, dir, "master");

  const ALL: CommitSetSpec = { kind: "all" };

  // |H̄| = 9 non-merge commits reachable (merge itself excluded; feature commit included via second parent reachability... but
  // since we used -X ours the merge keeps master's tree; the feature-branch commit IS still reachable from HEAD through the merge's second parent).
  const total = commitSetCount(db, id, ALL);
  assertEq("|H| non-merge commits reachable", total, 10);

  // Root directory metrics (ALL authors) over the whole history.
  const root = getObjectMetrics(id, "repository", "", ALL);
  // added: 3(root)+3(modify)+2(addb)+0(delb)+0(rename)+1(rename+edit)+1(.mailmap file itself)+2(bob sub/e.txt)+1(feature) = 13
  // removed: 0+1+0+2+0+0+0+0+0 = 3
  assertEq("root added", root.all.added, 13);
  assertEq("root removed", root.all.removed, 3);
  assertEq("root growth", root.all.growth, 10);
  assertEq("root churn", root.all.churn, 16);

  // Pure rename contributes churn 0 and is not a "modification".
  const dFile = getObjectMetrics(id, "file", "d.txt", ALL);
  // d.txt: rename+edit (+1,-0) then feature branch commit (+1,-0) => added=2,removed=0, modifications=2
  assertEq("d.txt added", dFile.all.added, 2);
  assertEq("d.txt modifications", dFile.all.modifications, 2);

  const cFile = getObjectMetrics(id, "file", "c.txt", ALL);
  // c.txt never has a nonzero-churn row (pure rename only) => no rows at all => all zero
  assertEq("c.txt added (pure rename only)", cFile.all.added, 0);
  assertEq("c.txt modifications (pure rename only)", cFile.all.modifications, 0);

  const bFile = getObjectMetrics(id, "file", "b.txt", ALL);
  assertEq("b.txt added", bFile.all.added, 2);
  assertEq("b.txt removed", bFile.all.removed, 2);
  assertEq("b.txt growth", bFile.all.growth, 0);
  assertEq("b.txt churn", bFile.all.churn, 4);
  assertEq("b.txt modifications", bFile.all.modifications, 2);

  const imgFile = getObjectMetrics(id, "file", "img.bin", ALL);
  assertEq("img.bin added (binary, never measured)", imgFile.all.added, 0);
  assertEq("img.bin modifications (binary, never measured)", imgFile.all.modifications, 0);

  // Directory rollup: sub/ should show Bob's +2 add.
  const subDir = getObjectMetrics(id, "directory", "sub", ALL);
  assertEq("sub/ added", subDir.all.added, 2);
  assertEq("sub/ modifications", subDir.all.modifications, 1);

  // Author identity: mailmap must merge alice@example.com and alice.alt@example.com into one key.
  const aliceOwnership = root.byAuthor.find((a) => a.author === "Alice A <alice@example.com>");
  const bobOwnership = root.byAuthor.find((a) => a.author === "Bob B <bob@example.com>");
  assertEq("mailmap merges alt email into one author row", !!aliceOwnership, true);
  assertEq("only two distinct authors after mailmap", root.byAuthor.length, 2);
  if (aliceOwnership && bobOwnership) {
    assertEq(
      "ownership sums to 1",
      Math.abs(aliceOwnership.ownership + bobOwnership.ownership - 1) < 1e-9,
      true
    );
  }

  // Modification frequency / churn rate with |H| guard.
  assertEq(
    "root modification_frequency = modifications/|H|",
    Math.abs(root.all.modificationFrequency - root.all.modifications / total) < 1e-9,
    true
  );
  assertEq(
    "root churn_rate = churn/|H|",
    Math.abs(root.all.churnRate - root.all.churn / total) < 1e-9,
    true
  );

  // Empty commit set => eta/rho = 0, not NaN/divide-by-zero.
  const empty: CommitSetSpec = { kind: "manual", shas: [] };
  const emptyRoot = getObjectMetrics(id, "repository", "", empty);
  assertEq("empty set modification_frequency = 0", emptyRoot.all.modificationFrequency, 0);
  assertEq("empty set churn_rate = 0", emptyRoot.all.churnRate, 0);

  // [i, j) range boundary exclusivity: a range ending exactly at a commit's
  // committer_date must exclude that commit.
  const modifyTs = Math.floor(new Date(dates[1].replace(" +0000", "Z")).getTime() / 1000);
  const rangeExclusive: CommitSetSpec = { kind: "range", from: undefined, to: modifyTs };
  const countExclusive = commitSetCount(db, id, rangeExclusive);
  assertEq("range to=modifyTs excludes the modify commit itself", countExclusive, 1); // only root

  const rangeInclusiveFrom: CommitSetSpec = { kind: "range", from: modifyTs, to: undefined };
  const countFrom = commitSetCount(db, id, rangeInclusiveFrom);
  assertEq("range from=modifyTs includes it (>=)", countFrom, total - 1);

  // Manual author merge: merge Bob into Alice, re-check ownership collapses to one row.
  mergeAuthors(id, "Bob B <bob@example.com>", "Alice A <alice@example.com>");
  const rootAfterMerge = getObjectMetrics(id, "repository", "", ALL);
  assertEq("manual merge collapses to a single author", rootAfterMerge.byAuthor.length, 1);
  assertEq(
    "manual merge: ownership is 1.0 for the merged author",
    Math.abs(rootAfterMerge.byAuthor[0].ownership - 1) < 1e-9,
    true
  );

  console.log(`\n${failures === 0 ? "ALL SELFTESTS PASSED" : `${failures} SELFTEST(S) FAILED`}`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
