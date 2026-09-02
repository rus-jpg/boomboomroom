import { NextResponse } from "next/server";
import { clearSessionCookie, currentSession } from "@/lib/server/session";
import { leaveRoomSession } from "@/lib/server/repo";
import { publishRoomEvent } from "@/lib/server/queues";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ session: null }, { status: 200 });
  return NextResponse.json({ session });
}

export async function DELETE() {
  const session = await currentSession();
  if (session) {
    try {
      await leaveRoomSession(session.participantId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "leave failed";
      if (message.includes("residents")) {
        return NextResponse.json({ error: "Residents stay in the house." }, { status: 403 });
      }
      throw err;
    }
    try {
      await publishRoomEvent({ type: "presence", participantId: session.participantId });
    } catch {
      /* realtime will notice on the next tick */
    }
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true, session: null });
}
