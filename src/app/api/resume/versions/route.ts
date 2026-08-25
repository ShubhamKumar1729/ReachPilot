import path from "node:path";
import { resumeVersionsCol } from "@/db";
import type { ResumeVersionRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CUSTOM_DIR = path.join(process.cwd(), "output", "custom");

function toRow(d: {
  _id: string;
  fileName: string;
  role: string;
  postAuthor: string;
  runId: string;
  mode: string;
  size: number;
  createdAt: Date;
}): ResumeVersionRow {
  return {
    id: d._id,
    fileName: d.fileName,
    role: d.role,
    postAuthor: d.postAuthor,
    runId: d.runId,
    mode: d.mode,
    size: d.size,
    createdAt: d.createdAt.toISOString(),
  };
}

export async function GET() {
  try {
    const col = await resumeVersionsCol();
    const docs = await col.find({}).sort({ createdAt: -1 }).limit(100).toArray();
    return Response.json({ ok: true, versions: docs.map(toRow) });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
