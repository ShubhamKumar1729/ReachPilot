import { runsCol } from "@/db";
import { stopRun, isRunActive } from "@/engine/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const stopped = stopRun(id);
  if (!stopped && !isRunActive(id)) {
    // Not in memory (process restart) — mark directly.
    const runs = await runsCol();
    await runs.updateOne(
      { _id: id },
      { $set: { status: "stopped", finishedAt: new Date() } }
    );
    return Response.json({ ok: true, stopped: false, forced: true });
  }
  return Response.json({ ok: true, stopped });
}
