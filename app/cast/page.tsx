import { redirect } from "next/navigation";
import { CastForm } from "@/components/CastForm";
import { currentSession } from "@/lib/server/session";

export default async function CastPage() {
  const session = await currentSession();
  if (session && session.status !== "blocked") redirect("/room");
  return (
    <main className="cast">
      <section className="cast-copy">
        <p className="eyebrow">Boom Boom Room</p>
        <h2 className="display" style={{ fontSize: "clamp(40px, 8vw, 72px)", margin: "12px 0" }}>
          No profiles.
          <br />
          One night.
        </h2>
        <p className="lede" style={{ margin: 0 }}>
          5–20 people. FIFO booth. Sixty-second sets. House keeps the floor moving while your track renders.
        </p>
      </section>
      <CastForm />
    </main>
  );
}
