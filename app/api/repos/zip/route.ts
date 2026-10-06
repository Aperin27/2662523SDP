import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { addRepoFromZip, ensureUploadsDir } from "@/lib/repos";

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const ref = (form?.get("ref") as string | null)?.trim() || "HEAD";
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "A zip file is required." }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".zip")) {
    return NextResponse.json({ error: "File must be a .zip archive." }, { status: 400 });
  }

  const uploadsDir = ensureUploadsDir();
  const tmpPath = path.join(uploadsDir, `${Date.now()}-${file.name}`);
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(tmpPath, buf);

  try {
    const displayName = file.name.replace(/\.zip$/i, "");
    const id = await addRepoFromZip(tmpPath, displayName, ref);
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    fs.rm(tmpPath, { force: true }, () => {});
  }
}
