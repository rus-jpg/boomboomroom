import Link from "next/link";
import { currentSession } from "@/lib/server/session";

export default async function LandingPage() {
  const session = await currentSession();
  return (
    <main className="landing">
      <div className="landing-inner">
        <p className="eyebrow">Turntable.fm × generative cinema</p>
        <div className="pulse-ring" aria-hidden />
        <h1 className="display">
          BOOM
          <br />
          BOOM
          <br />
          ROOM
        </h1>
        <p className="lede">
          One midnight room. Cast a face. Take the booth for 60 seconds. MiniMax writes the track while six
          H3 Max clips cut your crew into the video.
        </p>
        {session ? (
          <Link className="cta" href="/room">
            Back into the room
          </Link>
        ) : (
          <Link className="cta" href="/cast">
            Cast yourself
          </Link>
        )}
      </div>
    </main>
  );
}
