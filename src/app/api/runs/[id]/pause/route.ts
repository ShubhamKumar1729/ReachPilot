import { runsCol } from "@/db";
import { pauseRun, isRunActive } from "@/engine/runner";

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
  const paused = pauseRun(id);
  if (paused) {
    const runs = await runsCol();
    await runs.updateOne({ _id: id }, { $set: { paused: true } });
  }
  return Response.json({ ok: true, paused });
}
