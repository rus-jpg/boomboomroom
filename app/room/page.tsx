import type { Metadata } from "next";
import { RoomClient } from "@/components/RoomClient";
import { buildRoomState } from "@/lib/server/room-state";
import { currentSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Boom Boom Room",
  description: "A live AI music party — cast in, dance, take the booth.",
  openGraph: {
    title: "Boom Boom Room",
    description: "A live AI music party — cast in, dance, take the booth.",
    siteName: "Boom Boom Room",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Boom Boom Room",
    description: "A live AI music party — cast in, dance, take the booth.",
  },
};

export default async function RoomPage() {
  const session = await currentSession();
  const state = await buildRoomState();
  const realtimeUrl = process.env.NEXT_PUBLIC_REALTIME_URL || "";
  return <RoomClient initial={state} session={session} realtimeUrl={realtimeUrl} />;
}
