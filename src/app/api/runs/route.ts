import { randomUUID } from "node:crypto";
import { runsCol, toRunRow, type RunDoc } from "@/db";
import { config } from "@/lib/config";
import { startRun } from "@/engine/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const col = await runsCol();
    const docs = await col.find({}).sort({ createdAt: -1 }).limit(30).toArray();
    return Response.json({ ok: true, runs: docs.map(toRunRow) });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      role?: string;
      query?: string;
      maxEmails?: number;
      customizeResume?: boolean;
      dryRun?: boolean;
    };

    const role = (body.role ?? "").trim().slice(0, 120);
    const query = (body.query ?? "").trim().slice(0, 500);
    const maxEmails = Math.min(
      500,
      Math.max(1, Math.floor(Number(body.maxEmails) || config.bot.maxEmailsPerRole))
    );
    const customizeResume = Boolean(body.customizeResume);
    const dryRun = body.dryRun !== false; // default to dry-run for safety
    const engineMode =
      !dryRun && config.engineMode === "live" ? "live" : "simulate";

    if (!role || !query) {
      return Response.json(
        { ok: false, error: "role and query are required" },
        { status: 400 }
      );
    }

    const id = randomUUID();
    const doc: RunDoc = {
      _id: id,
      role,
      query,
      maxEmails,
      customizeResume,
      dryRun,
      engineMode,
      status: "queued",
      sentCount: 0,
      skippedCount: 0,
      postsScanned: 0,
      error: null,
      createdAt: new Date(),
      finishedAt: null,
    };

    const col = await runsCol();
    await col.insertOne(doc);

    startRun(id);
    return Response.json({ ok: true, id, engineMode });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
