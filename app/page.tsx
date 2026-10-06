"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  btnPrimary,
  card,
  inputCls,
  tableTh,
  tableThNum,
  tableTd,
  tableTdNum,
  tableWrap,
  IconGit,
  IconUpload,
  IconSpinner,
} from "./ui";

interface RepoRow {
  id: number;
  slug: string;
  name: string;
  source_type: "url" | "zip";
  source_url: string | null;
  ref: string;
  status: string;
  commit_count: number;
  archived: number;
  error: string | null;
  created_at: number;
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "ready"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400"
      : status === "failed"
        ? "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400"
        : "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

export default function Home() {
  const [repos, setRepos] = useState<RepoRow[] | null>(null);
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipRef, setZipRef] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadRepos() {
    const res = await fetch("/api/repos");
    const data = await res.json();
    setRepos(data.repos ?? []);
  }

  useEffect(() => {
    loadRepos();
    pollRef.current = setInterval(loadRepos, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleAddUrl(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAdding(true);
    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, ref: ref || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add repository");
      setUrl("");
      setRef("");
      await loadRepos();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleAddZip(e: React.FormEvent) {
    e.preventDefault();
    if (!zipFile) return;
    setError(null);
    setAdding(true);
    try {
      const form = new FormData();
      form.append("file", zipFile);
      if (zipRef) form.append("ref", zipRef);
      const res = await fetch("/api/repos/zip", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add repository");
      setZipFile(null);
      setZipRef("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadRepos();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleArchive(id: number, archived: boolean) {
    await fetch(`/api/repos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    await loadRepos();
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight">Repositories</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Measure file, directory, repository, commit-set and author metrics for any git repository.
      </p>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <form onSubmit={handleAddUrl} className={`${card} p-5`}>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
              <IconGit className="h-4.5 w-4.5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Add by clone URL</h2>
              <p className="text-xs text-neutral-500">Full history is cloned (never shallow).</p>
            </div>
          </div>
          <input
            className={`mt-4 ${inputCls}`}
            placeholder="https://github.com/DaveGamble/cJSON.git"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <input
            className={`mt-2 ${inputCls}`}
            placeholder="ref / commit hash (optional, default HEAD)"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
          <button type="submit" disabled={adding} className={`${btnPrimary} mt-4`}>
            {adding ? (
              <IconSpinner className="h-4 w-4 animate-spin" />
            ) : (
              <IconGit className="h-4 w-4" />
            )}
            {adding ? "Adding…" : "Clone & analyze"}
          </button>
        </form>

        <form onSubmit={handleAddZip} className={`${card} p-5`}>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
              <IconUpload className="h-4.5 w-4.5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Add by zip upload</h2>
              <p className="text-xs text-neutral-500">Zip must include the .git folder.</p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
            className="mt-4 w-full cursor-pointer text-sm text-neutral-500 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-indigo-600 hover:file:bg-indigo-100 dark:file:bg-indigo-500/10 dark:file:text-indigo-400"
          />
          <input
            className={`mt-2 ${inputCls}`}
            placeholder="ref / commit hash (optional, default HEAD)"
            value={zipRef}
            onChange={(e) => setZipRef(e.target.value)}
          />
          <button type="submit" disabled={adding || !zipFile} className={`${btnPrimary} mt-4`}>
            {adding ? (
              <IconSpinner className="h-4 w-4 animate-spin" />
            ) : (
              <IconUpload className="h-4 w-4" />
            )}
            {adding ? "Adding…" : "Upload & analyze"}
          </button>
        </form>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mt-10 flex items-center gap-2.5">
        <h2 className="text-lg font-semibold">Repositories</h2>
        {repos !== null && repos.length > 0 && (
          <span className="rounded-full bg-neutral-200/70 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            {repos.length}
          </span>
        )}
      </div>

      {repos === null ? (
        <div className={`${tableWrap} mt-3 bg-white dark:bg-neutral-900`}>
          <div className="animate-pulse space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-8 rounded-md bg-neutral-100 dark:bg-neutral-800" />
            ))}
          </div>
        </div>
      ) : repos.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-neutral-300 bg-white/50 p-10 text-center dark:border-neutral-700 dark:bg-neutral-900/50">
          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            No repositories yet
          </p>
          <p className="mt-1 text-xs text-neutral-500">Add one above to get started.</p>
        </div>
      ) : (
        <div className={`${tableWrap} mt-3 bg-white dark:bg-neutral-900`}>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={tableTh}>Name</th>
                <th className={tableTh}>Source</th>
                <th className={tableTh}>Ref</th>
                <th className={tableTh}>Status</th>
                <th className={tableThNum}>Commits</th>
                <th className={`${tableThNum} w-24`}></th>
              </tr>
            </thead>
            <tbody>
              {repos.map((r) => (
                <tr
                  key={r.id}
                  className="transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                >
                  <td className={tableTd}>
                    {r.status === "ready" ? (
                      <Link
                        href={`/repos/${r.id}`}
                        className="font-medium text-indigo-600 transition hover:underline dark:text-indigo-400"
                      >
                        {r.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.name}</span>
                    )}
                    {r.archived ? (
                      <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-800">
                        archived
                      </span>
                    ) : null}
                    {r.error && (
                      <div className="mt-0.5 max-w-md truncate text-xs text-red-600 dark:text-red-400" title={r.error}>
                        {r.error.slice(0, 80)}
                      </div>
                    )}
                  </td>
                  <td className={tableTd}>
                    <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-500 dark:bg-neutral-800">
                      {r.source_type}
                    </span>
                  </td>
                  <td className={tableTd}>
                    <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                      {r.ref.slice(0, 12)}
                    </code>
                  </td>
                  <td className={tableTd}>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className={tableTdNum}>
                    {r.commit_count ? r.commit_count.toLocaleString() : "—"}
                  </td>
                  <td className={`${tableTdNum} w-24`}>
                    <button
                      onClick={() => handleArchive(r.id, !r.archived)}
                      className="text-xs text-neutral-500 underline-offset-2 transition hover:text-neutral-900 hover:underline dark:hover:text-neutral-100"
                    >
                      {r.archived ? "unarchive" : "archive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
