"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

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
  const color =
    status === "ready"
      ? "bg-green-100 text-green-800"
      : status === "failed"
        ? "bg-red-100 text-red-800"
        : "bg-amber-100 text-amber-800";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${color}`}>
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
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold">RAT — Repo Analysis Tool</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Measure file, directory, repository, commit-set and author metrics for any git repository.
      </p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <form
          onSubmit={handleAddUrl}
          className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
        >
          <h2 className="font-medium">Add by clone URL</h2>
          <p className="mt-1 text-xs text-neutral-500">Full history is cloned (never shallow).</p>
          <input
            className="mt-3 w-full rounded border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            placeholder="https://github.com/DaveGamble/cJSON.git"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <input
            className="mt-2 w-full rounded border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            placeholder="ref / commit hash (optional, default HEAD)"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
          <button
            type="submit"
            disabled={adding}
            className="mt-3 rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {adding ? "Adding…" : "Clone & analyze"}
          </button>
        </form>

        <form
          onSubmit={handleAddZip}
          className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
        >
          <h2 className="font-medium">Add by zip upload</h2>
          <p className="mt-1 text-xs text-neutral-500">Zip must include the .git folder.</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
            className="mt-3 w-full text-sm"
          />
          <input
            className="mt-2 w-full rounded border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            placeholder="ref / commit hash (optional, default HEAD)"
            value={zipRef}
            onChange={(e) => setZipRef(e.target.value)}
          />
          <button
            type="submit"
            disabled={adding || !zipFile}
            className="mt-3 rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {adding ? "Adding…" : "Upload & analyze"}
          </button>
        </form>
      </div>

      {error && (
        <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <h2 className="mt-10 font-medium">Repositories</h2>
      {repos === null ? (
        <p className="mt-2 text-sm text-neutral-500">Loading…</p>
      ) : repos.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">
          No repositories yet — add one above to get started.
        </p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-neutral-500">
            <tr>
              <th className="py-1.5">Name</th>
              <th>Source</th>
              <th>Ref</th>
              <th>Status</th>
              <th>Commits</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {repos.map((r) => (
              <tr key={r.id} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="py-2">
                  {r.status === "ready" ? (
                    <Link href={`/repos/${r.id}`} className="font-medium underline">
                      {r.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{r.name}</span>
                  )}
                  {r.error && (
                    <div className="text-xs text-red-600" title={r.error}>
                      {r.error.slice(0, 80)}
                    </div>
                  )}
                </td>
                <td className="text-neutral-500">{r.source_type}</td>
                <td className="text-neutral-500">
                  <code className="text-xs">{r.ref.slice(0, 12)}</code>
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td className="text-neutral-500">{r.commit_count || "—"}</td>
                <td className="text-right">
                  <button
                    onClick={() => handleArchive(r.id, !r.archived)}
                    className="text-xs text-neutral-500 underline"
                  >
                    {r.archived ? "unarchive" : "archive"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
