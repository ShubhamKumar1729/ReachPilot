import fs from "node:fs";
import path from "node:path";
import { resumeVersionsCol } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CUSTOM_DIR = path.join(process.cwd(), "output", "custom");

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const col = await resumeVersionsCol();
    const doc = await col.findOne({ _id: id });
    if (!doc) {
      return Response.json({ ok: false, error: "not found" }, { status: 404 });
    }
    // Only ever delete files inside output/custom with a pdf name —
    // the original base resume is never touched.
    const file = path.join(CUSTOM_DIR, path.basename(doc.fileName));
    if (file.startsWith(CUSTOM_DIR) && file.endsWith(".pdf")) {
      await fs.promises.unlink(file).catch(() => undefined);
    }
    await col.deleteOne({ _id: id });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
