import { COMPOSE_WINDOW_MS } from "./constants";

/** Booth clock starts when the entry is promoted to preparing, not when they joined the queue. */
export function composeStartedAtMs(entry: { preparing_at?: string | null; created_at: string }): number {
  const raw = entry.preparing_at || entry.created_at;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

export function composeDeadlineMs(
  entry: { preparing_at?: string | null; created_at: string },
  windowMs = COMPOSE_WINDOW_MS,
): number {
  return composeStartedAtMs(entry) + windowMs;
}

export function isComposeWindowExpired(
  entry: { preparing_at?: string | null; created_at: string },
  now = Date.now(),
  windowMs = COMPOSE_WINDOW_MS,
): boolean {
  return now >= composeDeadlineMs(entry, windowMs);
}
