import { mongoStatus } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await mongoStatus();
  if (status.ok) {
    return Response.json({ ok: true, embedded: status.embedded });
  }
  return Response.json({ ok: false }, { status: 500 });
}
