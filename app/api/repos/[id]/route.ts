import { NextRequest, NextResponse } from "next/server";
import { archiveRepo, getLatestJob, getRepo } from "@/lib/repos";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  const repo = getRepo(id);
  if (!repo) return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  const job = getLatestJob(id) ?? null;
  return NextResponse.json({ repo, job });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  const body = await req.json().catch(() => ({}));
  if (typeof body.archived === "boolean") {
    archiveRepo(id, body.archived);
  }
  const repo = getRepo(id);
  return NextResponse.json({ repo });
}
