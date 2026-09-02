import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_TTL_DAYS } from "@/lib/shared/constants";
import type { SessionView } from "@/lib/shared/types";
import { isBanned, isMuted } from "@/lib/shared/moderation";
import { decodeSessionCookie, encodeSessionCookie, sha256 } from "./crypto";
import { getParticipantBySessionHash } from "./repo";
import { signedUrl } from "./storage";

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return decodeSessionCookie(jar.get(SESSION_COOKIE)?.value);
}

export async function writeSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, encodeSessionCookie(token), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function currentSession(): Promise<SessionView | null> {
  const token = await readSessionToken();
  if (!token) return null;
  const participant = await getParticipantBySessionHash(sha256(token));
  if (!participant) return null;
  const characterUrl = participant.character_reference_url
    ? (await signedUrl(participant.character_reference_url)) || participant.character_reference_url
    : null;
  return {
    participantId: participant.id,
    displayName: participant.display_name,
    status: participant.status,
    characterUrl,
    regenerateUsed: participant.regenerate_used,
    muted: isMuted(participant.muted_until),
    banned: isBanned(participant.banned_until),
  };
}
