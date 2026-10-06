PROJECT RULES — RAT (Repo Analysis Tool). Apply to every change.
- Stack: Next.js 15 App Router + TypeScript + Tailwind + better-sqlite3 (pinned for Node 18).
  next.config: serverExternalPackages: ['better-sqlite3']. DB access only in server code.
- ONE db module (lib/db.ts or src/lib/db.ts). DB file ./data/app.db; create folder/file/tables/
  indexes on first use (CREATE TABLE IF NOT EXISTS). A fresh git clone must run with no setup.
- Git analysis: shell out to the system git CLI (child_process), stream output. Never
  reimplement git. Never modify an ingested repo's git data. No DELETE of ingested data
  (removing a repo = archived flag).
- Cache-first: ingest once into SQLite (commits, changes, dir rollups, authors, parents).
  Every metric is SQL over the cache — never recompute from git per request. No N+1; index
  columns we filter/sort by.
- Metric semantics (do not "fix"): non-merge commits only; COMMITTER date %ct; H_t = ct>=t,
  H_i,j = i<=ct<j; rename detection -M50% always; pure rename = 0/0; rename+edit counted at
  NEW path; deletions = removed lines on the path; binary ('-' in numstat) never measured;
  dirs roll up every ancestor incl. root; repository metrics = root; growth=a-r, churn=a+r;
  modifications n = commits in H with churn>0; eta=n/|H|, rho=churn/|H| (0 when |H|=0);
  author identity = "Name <email>" AFTER mailmap (%aN/%aE + --use-mailmap); manual merges
  via DB alias table; ownership = lambda_a/lambda (0 if lambda=0).
- Filtering = SQL parameters on one query builder: repository, author, file/dir, commit set
  (all | [from,to) | manual hash list).
- Ingest runs as a background job with progress (jobs table + polling). Big repos must not
  block the UI or time out. cJSON must ingest in seconds.
- Do not add a new npm library if an installed one can do the job. Allowed additions already
  installed: better-sqlite3, recharts, tsx (dev).
- Keep `npm install` and `npm run dev` working at all times. Do ONE feature per request.
  When finished: run `npm run build`, fix errors, then give exact browser test steps.
