import { NextRequest, NextResponse } from "next/server";
import { listAuthors, mergeAuthors } from "@/lib/metrics";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const repoId = Number(idStr);
  return NextResponse.json({ authors: listAuthors(repoId) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const repoId = Number(idStr);
  const body = await req.json().catch(() => ({}));
  const { source, target } = body as { source?: string; target?: string };
  if (!source || !target) {
    return NextResponse.json({ error: "source and target author keys are required" }, { status: 400 });
  }
  mergeAuthors(repoId, source, target);
  return NextResponse.json({ authors: listAuthors(repoId) });
}
