import { NextResponse } from "next/server";
import { buildRoomState } from "@/lib/server/room-state";
import { currentSession } from "@/lib/server/session";

export async function GET() {
  const session = await currentSession();
  const state = await buildRoomState();
  return NextResponse.json({ session, state });
}
