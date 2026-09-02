import { NextResponse } from "next/server";
import { currentSession } from "@/lib/server/session";
import { issueTicket } from "@/lib/server/ticket";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "cast first" }, { status: 401 });
  return NextResponse.json({ ticket: issueTicket(session.participantId), participantId: session.participantId });
}
