import type { Metadata } from "next";
import { RoomClient } from "@/components/RoomClient";
import { buildRoomState } from "@/lib/server/room-state";
import { currentSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const title = "Boom Boom Room — live AI music party";
const description =
  "Multiplayer AI generative music party. One room. Sixty seconds on the booth.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    url: "/room",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Boom Boom Room — live AI music party",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default async function RoomPage() {
  const session = await currentSession();
  const state = await buildRoomState();
  const realtimeUrl = process.env.NEXT_PUBLIC_REALTIME_URL || "";
  return <RoomClient initial={state} session={session} realtimeUrl={realtimeUrl} />;
}
