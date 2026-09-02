const BLOCKED = [
  /\b(nigg\w*|fag\w*|kike|spic|retard\w*)\b/i,
  /\b(kill yourself|kys)\b/i,
  /https?:\/\/\S+/i,
];

export function normalizeChat(raw: string, maxLen: number): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

export function isBlockedText(text: string): boolean {
  return BLOCKED.some((re) => re.test(text));
}

export function isMuted(mutedUntil: string | null, now = Date.now()): boolean {
  return Boolean(mutedUntil && new Date(mutedUntil).getTime() > now);
}

export function isBanned(bannedUntil: string | null, now = Date.now()): boolean {
  return Boolean(bannedUntil && new Date(bannedUntil).getTime() > now);
}

export type RateBucket = { stamps: number[] };

export function takeToken(bucket: RateBucket, limit: number, windowMs: number, now = Date.now()): boolean {
  bucket.stamps = bucket.stamps.filter((t) => now - t < windowMs);
  if (bucket.stamps.length >= limit) return false;
  bucket.stamps.push(now);
  return true;
}
