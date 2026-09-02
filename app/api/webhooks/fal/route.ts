import { NextResponse } from "next/server";
import { getJobByFalId } from "@/lib/server/repo";
import { redisUrl } from "@/lib/server/env";
import Redis from "ioredis";
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
  const channel = redisUrl();
  if (channel) {
    const redis = new Redis(channel);
    await redis.publish("bbr:fal:webhook", JSON.stringify({ jobId, payload: body.payload ?? body, status }));
    await redis.quit();
  } else {
    await ingestFalWebhook(jobId, body.payload ?? body, status);
  }
  return NextResponse.json({ ok: true });
}
