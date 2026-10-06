"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface AllMetricRow {
  added: number;
  removed: number;
  growth: number;
  churn: number;
  modifications: number;
  modificationFrequency: number;
  churnRate: number;
}
interface AuthorMetricRow {
  author: string;
  added: number;
  removed: number;
  growth: number;
  churn: number;
  modifications: number;
  ownership: number;
}
interface ObjectMetrics {
  objectType: "repository" | "directory" | "file";
  path: string;
  all: AllMetricRow;
  byAuthor: AuthorMetricRow[];
}
interface ObjectListRow {
  path: string;
  added: number;
  removed: number;
  growth: number;
  churn: number;
  modifications: number;
  modificationFrequency: number;
  churnRate: number;
}
interface RepoRow {
  id: number;
  slug: string;
  name: string;
  source_type: string;
  source_url: string | null;
  ref: string;
  head_sha: string | null;
  status: string;
  commit_count: number;
  error: string | null;
}
interface JobRow {
  id: number;
  status: string;
  total: number;
  done: number;
  error: string | null;
}

type CommitSetMode = "all" | "range" | "manual";

function num(n: number, digits = 0) {
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function baseName(path: string) {
  if (path === "" || path === "/") return "/";
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

export default function RepoPage() {
  const params = useParams();
  const repoId = Number(params.id);

  const [repo, setRepo] = useState<RepoRow | null>(null);
  const [job, setJob] = useState<JobRow | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [currentType, setCurrentType] = useState<"repository" | "directory">("repository");
  const [data, setData] = useState<{ object: ObjectMetrics; children: { files: ObjectListRow[]; directories: ObjectListRow[] } } | null>(null);
  const [authors, setAuthors] = useState<string[]>([]);
  const [authorFilter, setAuthorFilter] = useState<string>("");

  const [commitSetMode, setCommitSetMode] = useState<CommitSetMode>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [manualShas, setManualShas] = useState("");

  const [mergeSource, setMergeSource] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");

  const [sortKey, setSortKey] = useState<keyof ObjectListRow>("churn");
  const [sortDesc, setSortDesc] = useState(true);

  const commitSetQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set("commitSet", commitSetMode);
    if (commitSetMode === "range") {
      if (fromDate) p.set("from", String(Math.floor(new Date(fromDate).getTime() / 1000)));
      if (toDate) p.set("to", String(Math.floor(new Date(toDate).getTime() / 1000)));
    } else if (commitSetMode === "manual") {
      p.set("shas", manualShas.split(/[\s,]+/).filter(Boolean).join(","));
    }
    return p;
  }, [commitSetMode, fromDate, toDate, manualShas]);

  async function loadRepoAndJob() {
    const res = await fetch(`/api/repos/${repoId}`);
    if (!res.ok) return;
    const d = await res.json();
    setRepo(d.repo);
    setJob(d.job);
  }

  async function loadMetrics() {
    const p = new URLSearchParams(commitSetQuery);
    p.set("objectType", currentType);
    p.set("path", currentPath);
    const res = await fetch(`/api/repos/${repoId}/metrics?${p.toString()}`);
    if (!res.ok) return;
    setData(await res.json());
  }

  async function loadAuthors() {
    const res = await fetch(`/api/repos/${repoId}/authors`);
    if (!res.ok) return;
    const d = await res.json();
    setAuthors(d.authors ?? []);
  }

  useEffect(() => {
    loadRepoAndJob();
    const t = setInterval(loadRepoAndJob, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  useEffect(() => {
    if (repo?.status === "ready") {
      loadMetrics();
      loadAuthors();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.status, currentPath, currentType, commitSetQuery]);

  function navigateTo(path: string) {
    setCurrentPath(path);
    setCurrentType("directory");
  }
  function navigateToRoot() {
    setCurrentPath("");
    setCurrentType("repository");
  }

  async function handleMerge(e: React.FormEvent) {
    e.preventDefault();
    if (!mergeSource || !mergeTarget || mergeSource === mergeTarget) return;
    await fetch(`/api/repos/${repoId}/authors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: mergeSource, target: mergeTarget }),
    });
    setMergeSource("");
    setMergeTarget("");
    await loadAuthors();
    await loadMetrics();
  }

  function exportUrl() {
    const p = new URLSearchParams(commitSetQuery);
    return `/api/repos/${repoId}/export?${p.toString()}`;
  }

  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [];
    const parts = currentPath.split("/");
    const crumbs: { label: string; path: string }[] = [];
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      crumbs.push({ label: part, path: acc });
    }
    return crumbs;
  }, [currentPath]);

  function sortRows(rows: ObjectListRow[]) {
    const sorted = [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv));
      }
      return (av as number) - (bv as number);
    });
    if (sortDesc) sorted.reverse();
    return sorted;
  }

  function toggleSort(key: keyof ObjectListRow) {
    if (sortKey === key) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  const authorRows = data
    ? authorFilter
      ? data.object.byAuthor.filter((a) => a.author === authorFilter)
      : data.object.byAuthor
    : [];

  if (!repo) {
    return <main className="mx-auto max-w-6xl px-6 py-10 text-sm text-neutral-500">Loading…</main>;
  }

  if (repo.status !== "ready") {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Link href="/" className="text-sm underline">
          ← Repositories
        </Link>
        <h1 className="mt-4 text-xl font-semibold">{repo.name}</h1>
        {repo.status === "failed" ? (
          <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            Ingest failed: {repo.error}
          </p>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-neutral-500">
              Analyzing… {job ? `${num(job.done)} / ${num(job.total)} commits` : "starting…"}
            </p>
            <div className="mt-2 h-2 w-full max-w-md overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
              <div
                className="h-full bg-neutral-900 dark:bg-neutral-100"
                style={{
                  width: job && job.total > 0 ? `${Math.min(100, (job.done / job.total) * 100)}%` : "5%",
                }}
              />
            </div>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/" className="text-sm underline">
        ← Repositories
      </Link>
      <h1 className="mt-4 text-xl font-semibold">{repo.name}</h1>
      <p className="text-xs text-neutral-500">
        ref <code>{repo.head_sha?.slice(0, 12)}</code> · {num(repo.commit_count)} non-merge commits
      </p>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-end gap-4 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
        <div>
          <label className="block text-xs text-neutral-500">Commit set</label>
          <select
            className="mt-1 rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
            value={commitSetMode}
            onChange={(e) => setCommitSetMode(e.target.value as CommitSetMode)}
          >
            <option value="all">All history</option>
            <option value="range">Time range</option>
            <option value="manual">Manual commit list</option>
          </select>
        </div>
        {commitSetMode === "range" && (
          <>
            <div>
              <label className="block text-xs text-neutral-500">From</label>
              <input
                type="date"
                className="mt-1 rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500">To (exclusive)</label>
              <input
                type="date"
                className="mt-1 rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </>
        )}
        {commitSetMode === "manual" && (
          <div className="min-w-64 flex-1">
            <label className="block text-xs text-neutral-500">Commit SHAs (comma/space separated)</label>
            <input
              className="mt-1 w-full rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
              value={manualShas}
              onChange={(e) => setManualShas(e.target.value)}
              placeholder="abc123, def456"
            />
          </div>
        )}
        <div>
          <label className="block text-xs text-neutral-500">Author</label>
          <select
            className="mt-1 max-w-56 rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
            value={authorFilter}
            onChange={(e) => setAuthorFilter(e.target.value)}
          >
            <option value="">All authors</option>
            {authors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <a
          href={exportUrl()}
          className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium dark:border-neutral-700"
        >
          Export CSV
        </a>
      </div>

      {/* Breadcrumb */}
      <div className="mt-4 text-sm">
        <button onClick={navigateToRoot} className="underline">
          /
        </button>
        {breadcrumbs.map((c, i) => (
          <span key={c.path}>
            {" / "}
            {i === breadcrumbs.length - 1 ? (
              c.label
            ) : (
              <button onClick={() => navigateTo(c.path)} className="underline">
                {c.label}
              </button>
            )}
          </span>
        ))}
      </div>

      {/* Summary cards */}
      {data && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Added", num(data.object.all.added)],
            ["Removed", num(data.object.all.removed)],
            ["Growth", num(data.object.all.growth)],
            ["Churn", num(data.object.all.churn)],
            ["Modifications", num(data.object.all.modifications)],
            ["Mod. frequency", pct(data.object.all.modificationFrequency)],
            ["Churn rate", num(data.object.all.churnRate, 2)],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
            >
              <div className="text-xs text-neutral-500">{label}</div>
              <div className="text-lg font-semibold">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Children table */}
      {data && (data.children.directories.length > 0 || data.children.files.length > 0) && (
        <div className="mt-6">
          <h2 className="font-medium">Contents</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-neutral-500">
              <tr>
                <th className="py-1.5">Path</th>
                {(["added", "removed", "growth", "churn", "modifications", "churnRate"] as const).map(
                  (k) => (
                    <th key={k} className="cursor-pointer select-none" onClick={() => toggleSort(k)}>
                      {k}
                      {sortKey === k ? (sortDesc ? " ↓" : " ↑") : ""}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {sortRows(data.children.directories).map((d) => (
                <tr key={d.path} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="py-1.5">
                    <button onClick={() => navigateTo(d.path)} className="underline">
                      📁 {baseName(d.path)}
                    </button>
                  </td>
                  <td>{num(d.added)}</td>
                  <td>{num(d.removed)}</td>
                  <td>{num(d.growth)}</td>
                  <td>{num(d.churn)}</td>
                  <td>{num(d.modifications)}</td>
                  <td>{num(d.churnRate, 2)}</td>
                </tr>
              ))}
              {sortRows(data.children.files).map((f) => (
                <tr key={f.path} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="py-1.5">📄 {baseName(f.path)}</td>
                  <td>{num(f.added)}</td>
                  <td>{num(f.removed)}</td>
                  <td>{num(f.growth)}</td>
                  <td>{num(f.churn)}</td>
                  <td>{num(f.modifications)}</td>
                  <td>{num(f.churnRate, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.children.directories.length === 0 && data.children.files.length === 0 && (
        <p className="mt-6 text-sm text-neutral-500">No changes under this path for the selected commit set.</p>
      )}

      {/* Author ownership */}
      {data && (
        <div className="mt-8">
          <h2 className="font-medium">Author ownership {authorFilter ? `(${authorFilter})` : ""}</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-neutral-500">
              <tr>
                <th className="py-1.5">Author</th>
                <th>Added</th>
                <th>Removed</th>
                <th>Growth</th>
                <th>Churn</th>
                <th>Modifications</th>
                <th>Ownership</th>
              </tr>
            </thead>
            <tbody>
              {authorRows.map((a) => (
                <tr key={a.author} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="py-1.5">{a.author}</td>
                  <td>{num(a.added)}</td>
                  <td>{num(a.removed)}</td>
                  <td>{num(a.growth)}</td>
                  <td>{num(a.churn)}</td>
                  <td>{num(a.modifications)}</td>
                  <td>{pct(a.ownership)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Author merge */}
      <form onSubmit={handleMerge} className="mt-8 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
        <h2 className="font-medium">Merge authors</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Not covered by .mailmap? Merge two author identities manually.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <select
            className="min-w-56 rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
            value={mergeSource}
            onChange={(e) => setMergeSource(e.target.value)}
          >
            <option value="">Merge this author…</option>
            {authors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <span className="text-neutral-500">into</span>
          <select
            className="min-w-56 rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
          >
            <option value="">…this author</option>
            {authors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!mergeSource || !mergeTarget || mergeSource === mergeTarget}
            className="rounded bg-neutral-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            Merge
          </button>
        </div>
      </form>
    </main>
  );
}
