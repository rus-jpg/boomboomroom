import { NextResponse } from "next/server";
import { getJobByFalId } from "@/lib/server/repo";
import { ingestFalWebhook } from "@/worker/ingest";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const jobIdParam = url.searchParams.get("jobId");
  const body = (await req.json().catch(() => ({}))) as {
    request_id?: string;
    status?: string;
    payload?: unknown;
  };
  const falId = body.request_id;
  const jobId = jobIdParam || (falId ? (await getJobByFalId(falId))?.id : null);
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "unknown job" }, { status: 404 });
  }
  const status = body.status === "OK" || body.status === "COMPLETED" ? "OK" : String(body.status ?? "ERROR");
  // Always ingest here. Vercel cannot publish to Railway private Redis.
  await ingestFalWebhook(jobId, body.payload ?? body, status);
  return NextResponse.json({ ok: true });
}
