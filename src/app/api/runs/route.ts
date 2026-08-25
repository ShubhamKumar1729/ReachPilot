import { randomUUID } from "node:crypto";
import {
  runsCol,
  saveLastRunConfig,
  toRunRow,
  type RoleCfg,
  type RunDoc,
} from "@/db";
import { config } from "@/lib/config";
import { buildQuery, type AdvancedSearch } from "@/lib/queryBuilder";
import { startRun } from "@/engine/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RoleInput {
  role?: string;
  query?: string;
  maxEmails?: number;
  customizeResume?: boolean;
}

const clampMax = (v: unknown, fallback: number) =>
  Math.min(500, Math.max(1, Math.floor(Number(v) || fallback)));

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
      // legacy single-role shape (still fully supported)
      role?: string;
      query?: string;
      maxEmails?: number;
      customizeResume?: boolean;
      // multi-role shape
      roles?: RoleInput[];
      globalLimit?: number | null;
      mode?: "live" | "test";
      // optional advanced search (never required)
      includeKeywords?: string;
      excludeKeywords?: string;
      locations?: string;
      companies?: string;
      excludeCompanies?: string;
    };

    const adv: AdvancedSearch = {
      includeKeywords: body.includeKeywords,
      excludeKeywords: body.excludeKeywords,
      locations: body.locations,
      companies: body.companies,
      excludeCompanies: body.excludeCompanies,
    };

    // Build the role list. Legacy single-role bodies keep working as-is.
    let roles: RoleCfg[] = [];
    if (Array.isArray(body.roles) && body.roles.length > 0) {
      for (const r of body.roles.slice(0, 10)) {
        const role = (r.role ?? "").trim().slice(0, 120);
        const base = (r.query ?? "").trim().slice(0, 500);
        if (!role || !base) continue;
        roles.push({
          role,
          query: buildQuery(base, adv),
          maxEmails: clampMax(r.maxEmails, config.bot.maxEmailsPerRole),
          customizeResume: Boolean(r.customizeResume),
        });
      }
    } else if (body.role && body.query) {
      roles.push({
        role: body.role.trim().slice(0, 120),
        query: buildQuery(body.query.trim().slice(0, 500), adv),
        maxEmails: clampMax(body.maxEmails, config.bot.maxEmailsPerRole),
        customizeResume: Boolean(body.customizeResume),
      });
    }

    if (roles.length === 0) {
      return Response.json(
        { ok: false, error: "at least one role with role + query is required" },
        { status: 400 }
      );
    }

    const mode: "live" | "test" = body.mode === "test" ? "test" : "live";
    const globalLimit =
      body.globalLimit == null
        ? null
        : Math.min(500, Math.max(1, Math.floor(Number(body.globalLimit)) || 0)) ||
          null;

    const sumBudget = roles.reduce((s, r) => s + r.maxEmails, 0);
    const totalBudget = globalLimit != null ? Math.min(globalLimit, sumBudget) : sumBudget;

    const id = randomUUID();
    const doc: RunDoc = {
      _id: id,
      role: roles[0].role,
      query: roles[0].query,
      maxEmails: totalBudget,
      customizeResume: roles[0].customizeResume,
      status: "queued",
      sentCount: 0,
      skippedCount: 0,
      postsScanned: 0,
      error: null,
      createdAt: new Date(),
      finishedAt: null,
      roles,
      globalLimit,
      mode,
    };

    const col = await runsCol();
    await col.insertOne(doc);

    // Smart defaults: remember this configuration for the next run.
    await saveLastRunConfig({ roles, globalLimit, mode }).catch(() => undefined);

    startRun(id);
    return Response.json({ ok: true, id });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
