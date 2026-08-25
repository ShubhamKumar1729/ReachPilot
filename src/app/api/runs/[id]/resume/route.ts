import { runsCol } from "@/db";
import { resumeRun, isRunActive } from "@/engine/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isRunActive(id)) {
    return Response.json(
      { ok: false, error: "run is not active" },
      { status: 409 }
    );
  }
  const resumed = resumeRun(id);
  if (resumed) {
    const runs = await runsCol();
    await runs.updateOne({ _id: id }, { $set: { paused: false } });
  }
  return Response.json({ ok: true, resumed });
}
