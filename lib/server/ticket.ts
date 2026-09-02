import { createHmac, timingSafeEqual } from "node:crypto";
import { sessionSecret } from "./env";

export function issueTicket(participantId: string, ttlMs = 5 * 60 * 1000): string {
  const exp = Date.now() + ttlMs;
  const body = `${participantId}.${exp}`;
  const sig = createHmac("sha256", sessionSecret()).update(body).digest("hex");
  return `${body}.${sig}`;
}

export function verifyTicket(ticket: string): string | null {
  const [participantId, expRaw, sig] = ticket.split(".");
  if (!participantId || !expRaw || !sig) return null;
  if (Number(expRaw) < Date.now()) return null;
  const expected = createHmac("sha256", sessionSecret()).update(`${participantId}.${expRaw}`).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return participantId;
}
