/** Client + server helpers for house livestream vs last-resort stubs. */

export const PLAYBACK_DRIFT_MS = 900;

/** Flat public stubs (`/house/house-0N.mp4`) — last-resort only, never the live stage. */
export function isStubHouseVideo(url: string | null | undefined): boolean {
  if (!url) return true;
  return /\/house\/house-0\d/.test(url);
}

export function isPlayableVideoUrl(url: string | null | undefined): boolean {
  return Boolean(url) && !isStubHouseVideo(url);
}
