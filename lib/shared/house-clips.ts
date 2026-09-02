import { CLIP_COUNT } from "./constants";
import { isDjBoothSlot } from "./stage-cast";

/** Canonical roles stored on `media_assets.role` (and job payload). */
export type MediaClipRole = "dj" | "dancer" | "crowd" | "booth" | "floor";

export type HouseClipCandidate = {
  id: string;
  storage_key: string;
  participant_id: string | null;
  role?: string | null;
};

export function normalizeMediaRole(role: unknown): MediaClipRole | null {
  if (role === "dj" || role === "booth") return role === "booth" ? "booth" : "dj";
  if (role === "dancer" || role === "floor") return role === "floor" ? "floor" : "dancer";
  if (role === "crowd") return "crowd";
  return null;
}

export function isBoothClipRole(role: string | null | undefined): boolean {
  return role === "dj" || role === "booth";
}

export function isFloorClipRole(role: string | null | undefined): boolean {
  return role === "dancer" || role === "floor" || role === "crowd";
}

/**
 * Whether this clip may play while `holderId` is the labeled DJ.
 * Booth/DJ-tagged media of anyone else is never allowed. Untagged clips of
 * another person are also excluded — they may be leftover wrong-face DJ takes.
 */
export function clipAllowedForHolder(clip: HouseClipCandidate, holderId: string | null): boolean {
  const role = normalizeMediaRole(clip.role);
  if (isBoothClipRole(role)) {
    return Boolean(holderId) && clip.participant_id === holderId;
  }
  if (isFloorClipRole(role)) return true;
  if (!clip.participant_id) return true;
  return clip.participant_id === holderId;
}

/** Holder's own booth takes, including untagged legacy clips of that person. */
export function clipIsHolderBooth(clip: HouseClipCandidate, holderId: string | null): boolean {
  if (!holderId || clip.participant_id !== holderId) return false;
  const role = normalizeMediaRole(clip.role);
  if (isBoothClipRole(role)) return true;
  if (isFloorClipRole(role)) return false;
  return true;
}

export function countHolderReadyClips(clips: HouseClipCandidate[], holderId: string | null) {
  let booth = 0;
  let floor = 0;
  for (const clip of clips) {
    if (!clipAllowedForHolder(clip, holderId)) continue;
    if (clipIsHolderBooth(clip, holderId)) booth += 1;
    else floor += 1;
  }
  return { booth, floor, allowed: booth + floor };
}

export type HouseClipPick = {
  keys: string[];
  claimIds: string[];
};

/**
 * Build a turn playlist: booth slots are only the labeled holder.
 * Missing holder booth clips are filled with floor/dancer clips — never another DJ face.
 */
export function selectHouseTurnClips(
  clips: HouseClipCandidate[],
  holderId: string | null,
  count = CLIP_COUNT,
): HouseClipPick {
  const allowed = clips.filter((clip) => clipAllowedForHolder(clip, holderId));
  const booth = allowed.filter((clip) => clipIsHolderBooth(clip, holderId));
  const floor = allowed.filter((clip) => !clipIsHolderBooth(clip, holderId));

  const keys: string[] = [];
  const claimIds: string[] = [];
  const usedIds = new Set<string>();

  const pickUnique = (list: HouseClipCandidate[]): HouseClipCandidate | null => {
    for (const clip of list) {
      if (usedIds.has(clip.id)) continue;
      usedIds.add(clip.id);
      return clip;
    }
    return null;
  };

  for (let i = 0; i < count; i++) {
    const wantBooth = Boolean(holderId) && isDjBoothSlot(i, count);
    let clip: HouseClipCandidate | null = null;
    if (wantBooth) {
      clip = pickUnique(booth) ?? booth[0] ?? pickUnique(floor);
    } else {
      clip = pickUnique(floor) ?? pickUnique(booth) ?? floor[0] ?? booth[0] ?? null;
    }
    if (!clip) break;
    keys.push(clip.storage_key);
    if (!claimIds.includes(clip.id)) claimIds.push(clip.id);
  }

  return { keys, claimIds };
}

export function jobPayloadRole(payload: unknown): MediaClipRole | null {
  return normalizeMediaRole((payload as { role?: unknown } | null)?.role);
}

export function isBoothHouseJob(job: { payload: unknown; participant_id?: string | null }): boolean {
  return isBoothClipRole(jobPayloadRole(job.payload));
}
