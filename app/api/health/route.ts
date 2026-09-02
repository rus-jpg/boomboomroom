import { NextResponse } from "next/server";
import { hasSupabaseAdmin, isMockMode } from "@/lib/server/env";
import { hasRedis } from "@/lib/server/queues";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "web",
    mockMode: isMockMode(),
    supabase: hasSupabaseAdmin(),
    redis: hasRedis(),
  });
}
