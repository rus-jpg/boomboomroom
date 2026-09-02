import { RoomClient } from "@/components/RoomClient";
import { buildRoomState } from "@/lib/server/room-state";
import { currentSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function RoomPage() {
  const session = await currentSession();
  const state = await buildRoomState();
  const realtimeUrl = process.env.NEXT_PUBLIC_REALTIME_URL || "";
  return <RoomClient initial={state} session={session} realtimeUrl={realtimeUrl} />;
}
