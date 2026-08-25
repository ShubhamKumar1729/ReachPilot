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
      roleAgg,
      runAgg,
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
      sent
        .aggregate([
          {
            $group: {
              _id: "$role",
              sent: { $sum: { $cond: [{ $eq: ["$status", "SENT"] }, 1, 0] } },
              failed: { $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] } },
            },
          },
        ])
        .toArray(),
      runs
        .aggregate([
          {
            $group: {
              _id: "$role",
              runs: { $sum: 1 },
              lastRunAt: { $max: "$createdAt" },
            },
          },
          { $sort: { lastRunAt: -1 } },
          { $limit: 10 },
        ])
        .toArray(),
    ]);

    const byRole = (
      runAgg as Array<{ _id: string; runs: number; lastRunAt: Date }>
    )
      .map((r) => {
        const s = (
          roleAgg as Array<{ _id: string; sent: number; failed: number }>
        ).find((x) => x._id === r._id);
        return {
          role: r._id,
          runs: r.runs,
          sent: s?.sent ?? 0,
          failed: s?.failed ?? 0,
          lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
        };
      })
      .slice(0, 10);

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
      byRole,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
