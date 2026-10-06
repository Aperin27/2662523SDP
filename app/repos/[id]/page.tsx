"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  btnPrimary,
  btnSecondary,
  card,
  inputCls,
  selectCls,
  tableTh,
  tableThNum,
  tableTd,
  tableTdNum,
  tableWrap,
  IconArrowLeft,
  IconDownload,
  IconFile,
  IconFolder,
  IconSpinner,
} from "../../ui";

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

const CONTENT_COLS: [keyof ObjectListRow, string][] = [
  ["added", "Added"],
  ["removed", "Removed"],
  ["growth", "Growth"],
  ["churn", "Churn"],
  ["modifications", "Mods"],
  ["churnRate", "Churn rate"],
];

const AVATAR_BG = [
  "bg-indigo-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-teal-500",
  "bg-fuchsia-500",
];

function initialsOf(authorKey: string) {
  const name = authorKey.replace(/\s*<.*>\s*/, "").trim() || authorKey;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function avatarColor(authorKey: string) {
  let h = 0;
  for (let i = 0; i < authorKey.length; i++) h = (h * 31 + authorKey.charCodeAt(i)) | 0;
  return AVATAR_BG[Math.abs(h) % AVATAR_BG.length];
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
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-32 rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="h-8 w-64 rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="h-28 rounded-xl bg-neutral-200 dark:bg-neutral-800" />
        </div>
      </main>
    );
  }

  if (repo.status !== "ready") {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 transition hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          <IconArrowLeft className="h-3.5 w-3.5" />
          Repositories
        </Link>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">{repo.name}</h1>
        {repo.status === "failed" ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            Ingest failed: {repo.error}
          </p>
        ) : (
          <div className={`${card} mt-4 max-w-lg p-6`}>
            <div className="flex items-center gap-3">
              <IconSpinner className="h-5 w-5 shrink-0 animate-spin text-indigo-500" />
              <div>
                <h2 className="font-semibold">Analyzing repository…</h2>
                <p className="mt-0.5 text-sm text-neutral-500">
                  {job ? `${num(job.done)} / ${num(job.total)} commits ingested` : "Starting ingestion…"}
                </p>
              </div>
            </div>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
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
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-neutral-500 transition hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        <IconArrowLeft className="h-3.5 w-3.5" />
        Repositories
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{repo.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono dark:bg-neutral-800">
              {repo.head_sha?.slice(0, 12) ?? "…"}
            </code>
            <span>{num(repo.commit_count)} non-merge commits</span>
            <span className="text-neutral-300 dark:text-neutral-700">·</span>
            <span className="font-mono">{repo.source_type}</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className={`${card} mt-6 flex flex-wrap items-end gap-4 p-4 text-sm`}>
        <div>
          <label className="block text-xs font-medium text-neutral-500">Commit set</label>
          <select
            className={`${selectCls} mt-1`}
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
              <label className="block text-xs font-medium text-neutral-500">From</label>
              <input
                type="date"
                className={`${selectCls} mt-1`}
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-500">To (exclusive)</label>
              <input
                type="date"
                className={`${selectCls} mt-1`}
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </>
        )}
        {commitSetMode === "manual" && (
          <div className="min-w-64 flex-1">
            <label className="block text-xs font-medium text-neutral-500">
              Commit SHAs (comma/space separated)
            </label>
            <input
              className={`${inputCls} mt-1`}
              value={manualShas}
              onChange={(e) => setManualShas(e.target.value)}
              placeholder="abc123, def456"
            />
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-neutral-500">Author</label>
          <select
            className={`${selectCls} mt-1 max-w-56`}
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
        <a href={exportUrl()} className={btnSecondary}>
          <IconDownload className="h-3.5 w-3.5" />
          Export CSV
        </a>
      </div>

      {/* Breadcrumb */}
      <nav
        className="mt-4 flex items-center gap-1 overflow-x-auto rounded-lg border border-neutral-200 bg-white px-3 py-2 font-mono text-sm shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
        aria-label="Path"
      >
        <button
          onClick={navigateToRoot}
          className="shrink-0 rounded text-indigo-600 transition hover:underline dark:text-indigo-400"
        >
          root
        </button>
        {breadcrumbs.map((c, i) => (
          <span key={c.path} className="flex shrink-0 items-center gap-1">
            <span className="text-neutral-300 dark:text-neutral-700">/</span>
            {i === breadcrumbs.length - 1 ? (
              <span className="font-semibold text-neutral-900 dark:text-neutral-100">{c.label}</span>
            ) : (
              <button
                onClick={() => navigateTo(c.path)}
                className="rounded text-indigo-600 transition hover:underline dark:text-indigo-400"
              >
                {c.label}
              </button>
            )}
          </span>
        ))}
      </nav>

      {/* Summary cards */}
      {data && (
        <>
          <div className="mt-6 flex items-center gap-2.5">
            <h2 className="text-lg font-semibold">Metrics</h2>
            <span className="rounded-full border border-neutral-200 px-2.5 py-0.5 font-mono text-[11px] text-neutral-500 dark:border-neutral-700">
              {currentType}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["l⁺", "Added", num(data.object.all.added), "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"],
                ["l⁻", "Removed", num(data.object.all.removed), "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400"],
                ["δ", "Growth", num(data.object.all.growth), "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"],
                ["λ", "Churn", num(data.object.all.churn), "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"],
                ["n", "Modifications", num(data.object.all.modifications), "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400"],
                ["η", "Mod. frequency", pct(data.object.all.modificationFrequency), "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400"],
                ["ρ", "Churn rate", num(data.object.all.churnRate, 2), "bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400"],
              ] as [string, string, string, string][]
            ).map(([sym, label, value, chipCls]) => (
              <div key={label} className={`${card} p-4`}>
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-5 min-w-5 items-center justify-center rounded px-1 font-mono text-[11px] font-bold ${chipCls}`}
                  >
                    {sym}
                  </span>
                  <span className="text-xs font-medium text-neutral-500">{label}</span>
                </div>
                <div className="mt-2 text-xl font-semibold tabular-nums tracking-tight">{value}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Children table */}
      {data && (data.children.directories.length > 0 || data.children.files.length > 0) && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold">Contents</h2>
          <div className={`${tableWrap} mt-3 bg-white dark:bg-neutral-900`}>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={`${tableTh} min-w-48`}>Path</th>
                  {CONTENT_COLS.map(([k, label]) => (
                    <th
                      key={k}
                      className={`${tableThNum} cursor-pointer select-none transition hover:text-neutral-800 dark:hover:text-neutral-200`}
                      onClick={() => toggleSort(k)}
                      title={`Sort by ${label}`}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        {label}
                        {sortKey === k ? (
                          <span className="font-bold text-indigo-500">{sortDesc ? "↓" : "↑"}</span>
                        ) : (
                          <span className="text-neutral-300 dark:text-neutral-600">↕</span>
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortRows(data.children.directories).map((d) => (
                  <tr
                    key={d.path}
                    className="transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                  >
                    <td className={tableTd}>
                      <button
                        onClick={() => navigateTo(d.path)}
                        className="inline-flex items-center gap-2 font-medium text-indigo-600 transition hover:underline dark:text-indigo-400"
                      >
                        <IconFolder className="h-4 w-4 text-indigo-400 dark:text-indigo-500" />
                        {baseName(d.path)}
                      </button>
                    </td>
                    <td className={tableTdNum}>{num(d.added)}</td>
                    <td className={tableTdNum}>{num(d.removed)}</td>
                    <td className={tableTdNum}>{num(d.growth)}</td>
                    <td className={tableTdNum}>{num(d.churn)}</td>
                    <td className={tableTdNum}>{num(d.modifications)}</td>
                    <td className={tableTdNum}>{num(d.churnRate, 2)}</td>
                  </tr>
                ))}
                {sortRows(data.children.files).map((f) => (
                  <tr
                    key={f.path}
                    className="transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                  >
                    <td className={tableTd}>
                      <span className="inline-flex items-center gap-2 font-medium">
                        <IconFile className="h-4 w-4 text-neutral-400" />
                        {baseName(f.path)}
                      </span>
                    </td>
                    <td className={tableTdNum}>{num(f.added)}</td>
                    <td className={tableTdNum}>{num(f.removed)}</td>
                    <td className={tableTdNum}>{num(f.growth)}</td>
                    <td className={tableTdNum}>{num(f.churn)}</td>
                    <td className={tableTdNum}>{num(f.modifications)}</td>
                    <td className={tableTdNum}>{num(f.churnRate, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {data && data.children.directories.length === 0 && data.children.files.length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-neutral-300 bg-white/50 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900/50">
          No changes under this path for the selected commit set.
        </p>
      )}

      {/* Author ownership */}
      {data && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold">
            Author ownership{" "}
            {authorFilter && (
              <span className="font-mono text-xs font-normal text-neutral-500">({authorFilter})</span>
            )}
          </h2>
          <div className={`${tableWrap} mt-3 bg-white dark:bg-neutral-900`}>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={tableTh}>Author</th>
                  <th className={tableThNum}>Added</th>
                  <th className={tableThNum}>Removed</th>
                  <th className={tableThNum}>Growth</th>
                  <th className={tableThNum}>Churn</th>
                  <th className={tableThNum}>Mods</th>
                  <th className={tableThNum}>Ownership</th>
                </tr>
              </thead>
              <tbody>
                {authorRows.map((a) => (
                  <tr
                    key={a.author}
                    className="transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                  >
                    <td className={tableTd}>
                      <span className="inline-flex items-center gap-2.5">
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${avatarColor(a.author)}`}
                          title={a.author}
                        >
                          {initialsOf(a.author)}
                        </span>
                        <span className="font-medium">{a.author}</span>
                      </span>
                    </td>
                    <td className={tableTdNum}>{num(a.added)}</td>
                    <td className={tableTdNum}>{num(a.removed)}</td>
                    <td className={tableTdNum}>{num(a.growth)}</td>
                    <td className={tableTdNum}>{num(a.churn)}</td>
                    <td className={tableTdNum}>{num(a.modifications)}</td>
                    <td className={tableTdNum}>
                      <span className="flex flex-col items-end gap-1.5">
                        <span className="font-medium text-neutral-900 dark:text-neutral-200">
                          {pct(a.ownership)}
                        </span>
                        <span className="block h-1.5 w-20 overflow-hidden rounded-full bg-neutral-200/70 dark:bg-neutral-700/50">
                          <span
                            className="block h-full rounded-full bg-indigo-500"
                            style={{ width: `${Math.min(100, a.ownership * 100)}%` }}
                          />
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
                {authorRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="border-t border-neutral-100 px-4 py-6 text-center text-sm text-neutral-500 dark:border-neutral-800/70"
                    >
                      No author changes under this path for the selected commit set.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Author merge */}
      <form onSubmit={handleMerge} className={`${card} mt-8 p-5 text-sm`}>
        <h2 className="font-semibold">Merge authors</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Not covered by .mailmap? Merge two author identities manually.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            className={`${selectCls} min-w-56`}
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
          <span className="text-neutral-400">into</span>
          <select
            className={`${selectCls} min-w-56`}
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
            className={`${btnPrimary} px-3 py-1.5 text-xs`}
          >
            Merge
          </button>
        </div>
      </form>
    </main>
  );
}
