import fs from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUTPUT_DIR = path.join(process.cwd(), "output");
const CUSTOM_DIR = path.join(OUTPUT_DIR, "custom");

const SAFE_NAME = /^[\w][\w.-]*\.pdf$/;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const name = (url.searchParams.get("name") ?? "").trim();
    const dir = url.searchParams.get("dir") === "custom" ? "custom" : "base";
    const download = url.searchParams.get("download") === "1";

    if (!name || !SAFE_NAME.test(name)) {
      return Response.json({ ok: false, error: "invalid name" }, { status: 400 });
    }
    if (name.includes("..")) {
      return Response.json({ ok: false, error: "invalid name" }, { status: 400 });
    }

    const base = dir === "custom" ? CUSTOM_DIR : OUTPUT_DIR;
    const file = path.join(base, name);
    if (!file.startsWith(base + path.sep)) {
      return Response.json({ ok: false, error: "invalid path" }, { status: 400 });
    }
    // The base dir only ever serves the configured base resume.
    if (dir === "base" && name !== config.resumeFilename) {
      return Response.json({ ok: false, error: "not found" }, { status: 404 });
    }
    if (!fs.existsSync(file)) {
      return Response.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const buf = await fs.promises.readFile(file);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(buf.length),
        ...(download
          ? { "Content-Disposition": `attachment; filename="${name}"` }
          : { "Content-Disposition": "inline" }),
      },
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
