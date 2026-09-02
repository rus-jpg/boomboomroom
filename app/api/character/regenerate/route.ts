import { NextResponse } from "next/server";
import { hasRedis } from "@/lib/server/queues";
import { getParticipant, insertJob, updateParticipant } from "@/lib/server/repo";
import { currentSession } from "@/lib/server/session";
import { isMockMode } from "@/lib/server/env";
import { mockCharacterJpeg } from "@/worker/mock";
import { insertMedia } from "@/lib/server/repo";
import { uploadBytes } from "@/lib/server/storage";

export async function POST() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "cast first" }, { status: 401 });
  const person = await getParticipant(session.participantId);
  if (!person) return NextResponse.json({ error: "missing" }, { status: 404 });
  if (person.regenerate_used) return NextResponse.json({ error: "already used" }, { status: 409 });

  await updateParticipant(person.id, { regenerate_used: true, status: "processing" });
  await insertJob({
    kind: "character",
    participantId: person.id,
    payload: { regenerate: true, characterPrompt: person.character_prompt },
  });
  if (!process.env.VERCEL && isMockMode() && !hasRedis()) {
    const svg = mockCharacterJpeg(person.display_name, `${person.character_prompt} (alt)`);
    const storageKey = await uploadBytes("media", `characters/${person.id}-alt.svg`, svg, "image/svg+xml");
    await insertMedia({ kind: "character", storageKey, contentType: "image/svg+xml", participantId: person.id });
    await updateParticipant(person.id, { character_reference_url: storageKey, status: "ready" });
  }
  return NextResponse.json({ ok: true });
}
