import { NextResponse } from "next/server";
import { z } from "zod";
import { moderatorSecret } from "@/lib/server/env";
import { RoomEngine } from "@/realtime/engine";

const schema = z.object({
  action: z.enum(["mute", "ban", "skip"]),
  targetId: z.string().min(1),
  reason: z.string().max(240).optional(),
});

export async function POST(req: Request) {
  const secret = moderatorSecret();
  const header = req.headers.get("x-moderator-secret");
  if (!secret || header !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const engine = new RoomEngine();
  await engine.moderate(parsed.data.action, parsed.data.targetId, parsed.data.reason);
  return NextResponse.json({ ok: true });
}
