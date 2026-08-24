import { logsCol, runsCol, sentCol, toLogRow, toRunRow, toSentRow } from "@/db";
import { isRunActive } from "@/engine/runner";
import type { Filter } from "mongodb";
import type { LogDoc } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const after = parseInt(url.searchParams.get("after") ?? "0", 10) || 0;

    const [runs, logs, sent] = await Promise.all([runsCol(), logsCol(), sentCol()]);

    const run = await runs.findOne({ _id: id });
    if (!run) {
      return Response.json({ ok: false, error: "run not found" }, { status: 404 });
    }

    const logQuery: Filter<LogDoc> = { runId: id };
    if (after > 0) logQuery.seq = { $gt: after };

    const [logDocs, sentDocs] = await Promise.all([
      logs.find(logQuery).sort({ seq: 1 }).limit(500).toArray(),
      sent.find({ runId: id }).sort({ sentAt: 1 }).limit(1000).toArray(),
    ]);

    return Response.json({
      ok: true,
      run: toRunRow(run),
      logs: logDocs.map(toLogRow),
      sent: sentDocs.map(toSentRow),
      active: isRunActive(id),
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
