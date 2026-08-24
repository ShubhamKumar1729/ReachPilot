import { runsCol, sentCol, toRunRow, toSentRow } from "@/db";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [runs, sent] = await Promise.all([runsCol(), sentCol()]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalSent,
      totalFailed,
      uniqueEmails,
      todayCount,
      totalRuns,
      running,
      completed,
      recentRuns,
      recentSent,
    ] = await Promise.all([
      sent.countDocuments({ status: "SENT" }),
      sent.countDocuments({ status: "FAILED" }),
      sent.distinct("email"),
      sent.countDocuments({ status: "SENT", sentAt: { $gte: today } }),
      runs.countDocuments({}),
      runs.countDocuments({ status: { $in: ["running", "queued"] } }),
      runs.countDocuments({ status: "completed" }),
      runs.find({}).sort({ createdAt: -1 }).limit(6).toArray(),
      sent.find({}).sort({ sentAt: -1 }).limit(8).toArray(),
    ]);

    return Response.json({
      ok: true,
      totals: {
        totalSent,
        totalFailed,
        uniqueRecruiters: uniqueEmails.length,
      },
      today: { count: todayCount },
      runStats: { totalRuns, running, completed },
      recentRuns: recentRuns.map(toRunRow),
      recentSent: recentSent.map(toSentRow),
      dailyTarget: config.dailyResponseTarget,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
