import { NextRequest, NextResponse } from "next/server";
import { addRepoFromUrl, listRepos } from "@/lib/repos";

export async function GET() {
  const repos = listRepos();
  return NextResponse.json({ repos });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const url = body?.url?.trim();
  const ref = body?.ref?.trim() || "HEAD";
  if (!url) {
    return NextResponse.json({ error: "A repository URL is required." }, { status: 400 });
  }
  try {
    const id = addRepoFromUrl(url, ref);
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
