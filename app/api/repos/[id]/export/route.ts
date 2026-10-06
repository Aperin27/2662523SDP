import { NextRequest, NextResponse } from "next/server";
import { getRepo } from "@/lib/repos";
import { commitSetCount, getObjectMetrics, listAllObjects, parseCommitSetSpec } from "@/lib/metrics";
import { getDb } from "@/lib/db";


function csvField(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const repoId = Number(idStr);
  const repo = getRepo(repoId);
  if (!repo) return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const spec = parseCommitSetSpec(searchParams);
  const commitSetLabel = searchParams.get("commitSet") ?? "all";
  const commitCount = commitSetCount(getDb(), repoId, spec);


  const header = [
    "repo",
    "ref_sha",
    "commit_set",
    "commit_count",
    "object_type",
    "path",
    "author",
    "added",
    "removed",
    "growth",
    "churn",
    "modifications",
    "modification_frequency",
    "churn_rate",
    "ownership",
  ];
  const lines: string[] = [header.join(",")];

  const objects = listAllObjects(repoId);
  for (const obj of objects) {
    const m = getObjectMetrics(repoId, obj.objectType, obj.path, spec);
    const commonPath = obj.objectType === "repository" ? "/" : obj.path;

    lines.push(
      [
        repo.slug,
        repo.head_sha ?? "",
        commitSetLabel,
        commitCount,
        obj.objectType,
        csvField(commonPath),
        "ALL",
        m.all.added,
        m.all.removed,
        m.all.growth,
        m.all.churn,
        m.all.modifications,
        m.all.modificationFrequency,
        m.all.churnRate,
        "",
      ].join(",")
    );
    for (const a of m.byAuthor) {
      lines.push(
        [
          repo.slug,
          repo.head_sha ?? "",
          commitSetLabel,
          commitCount,
          obj.objectType,
          csvField(commonPath),
          csvField(a.author),
          a.added,
          a.removed,
          a.growth,
          a.churn,
          a.modifications,
          "",
          "",
          a.ownership,
        ].join(",")
      );
    }
  }

  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${repo.slug}-metrics.csv"`,
    },
  });
}
