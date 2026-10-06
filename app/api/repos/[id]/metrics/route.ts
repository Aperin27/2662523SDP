import { NextRequest, NextResponse } from "next/server";
import { getObjectMetrics, listChildren, parseCommitSetSpec } from "@/lib/metrics";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const repoId = Number(idStr);
  const { searchParams } = new URL(req.url);
  const objectType = (searchParams.get("objectType") ?? "repository") as
    | "repository"
    | "directory"
    | "file";
  const path = searchParams.get("path") ?? "";
  const spec = parseCommitSetSpec(searchParams);

  const object = getObjectMetrics(repoId, objectType, path, spec);
  const children =
    objectType !== "file" ? listChildren(repoId, path, spec) : { files: [], directories: [] };

  return NextResponse.json({ object, children });
}
