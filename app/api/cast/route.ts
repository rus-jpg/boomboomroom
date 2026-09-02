import { NextResponse } from "next/server";
import { z } from "zod";
import { CHARACTER_MAX, CHARACTER_MIN, FACE_MAX_BYTES, MAX_PARTICIPANTS, NAME_MAX, NAME_MIN } from "@/lib/shared/constants";
import { hashIp, randomToken, sha256 } from "@/lib/server/crypto";
import { hasRedis } from "@/lib/server/queues";
import { createParticipant, getRoomBySlug, insertJob, insertMedia, insertModeration, occupancy, updateParticipant } from "@/lib/server/repo";
import { writeSessionCookie } from "@/lib/server/session";
import { uploadBytes } from "@/lib/server/storage";
import { isMockMode } from "@/lib/server/env";
import { mockCharacterJpeg } from "@/worker/mock";

const schema = z.object({
  displayName: z.string().trim().min(NAME_MIN).max(NAME_MAX),
  characterPrompt: z.string().trim().min(CHARACTER_MIN).max(CHARACTER_MAX),
  consent: z.literal("true"),
});

export async function POST(req: Request) {
  const form = await req.formData();
  const parsed = schema.safeParse({
    displayName: form.get("displayName"),
    characterPrompt: form.get("characterPrompt"),
    consent: form.get("consent"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Name, character, and consent are required." }, { status: 400 });
  }
  const face = form.get("face");
  if (!(face instanceof File) || face.size < 32) {
    return NextResponse.json({ error: "Face photo required." }, { status: 400 });
  }
  if (face.size > FACE_MAX_BYTES) {
    return NextResponse.json({ error: "Face photo must be under 4MB." }, { status: 400 });
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(face.type)) {
    return NextResponse.json({ error: "Use a JPEG, PNG, or WebP face photo." }, { status: 400 });
  }

  const room = await getRoomBySlug();
  if ((await occupancy(room.id)) >= MAX_PARTICIPANTS) {
    return NextResponse.json({ error: "The room is full (20)." }, { status: 409 });
  }

  const token = randomToken();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const participant = await createParticipant({
    sessionHash: sha256(token),
    displayName: parsed.data.displayName,
    characterPrompt: parsed.data.characterPrompt,
    ipHash: hashIp(ip),
  });

  const faceBuf = Buffer.from(await face.arrayBuffer());
  const faceKey = await uploadBytes("faces", `${participant.id}/original.jpg`, faceBuf, face.type);
  await insertMedia({
    kind: "face",
    storageKey: faceKey,
    contentType: face.type,
    participantId: participant.id,
  });
  await updateParticipant(participant.id, { original_face_url: faceKey });
  await insertModeration({
    kind: "consent_accepted",
    targetId: participant.id,
    metadata: { consent: true, at: new Date().toISOString() },
  });

  await insertJob({
    kind: "character",
    participantId: participant.id,
    payload: { faceStorageKey: faceKey, characterPrompt: parsed.data.characterPrompt },
  });

  // Do not await Redis. Vercel cannot reach Railway's private Redis and would
  // hang the request. The worker claims `generation_jobs` with status=queued.
  if (!process.env.VERCEL && isMockMode() && !hasRedis()) {
    const svg = mockCharacterJpeg(participant.display_name, participant.character_prompt);
    const storageKey = await uploadBytes("media", `characters/${participant.id}.svg`, svg, "image/svg+xml");
    await insertMedia({ kind: "character", storageKey, contentType: "image/svg+xml", participantId: participant.id });
    await updateParticipant(participant.id, { character_reference_url: storageKey, status: "ready" });
  }

  await writeSessionCookie(token);
  return NextResponse.json({ ok: true, participantId: participant.id, mock: isMockMode() });
}
