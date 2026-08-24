import { sentCol, toSentRow } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const col = await sentCol();
    const docs = await col.find({}).sort({ sentAt: -1 }).limit(500).toArray();
    return Response.json({ ok: true, rows: docs.map(toSentRow) });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const col = await sentCol();
    const res = await col.deleteMany({});
    return Response.json({ ok: true, deleted: res.deletedCount });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
