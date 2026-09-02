import { CLIP_COUNT } from "./constants";

export type DjClipRole = "booth" | "floor" | "crowd";
export type HouseClipRole = "dj" | "dancer" | "crowd";

export type CastFace = {
  id: string;
  display_name: string;
  character_prompt: string;
  character_reference_url?: string | null;
  is_resident?: boolean;
};

export type DjClipCast = {
  role: DjClipRole;
  person: CastFace | null;
};

export type HouseClipCast = {
  role: HouseClipRole;
  person: CastFace | null;
};

/** 3 of 6 clips: the actual booth DJ behind the decks. */
export const DJ_BOOTH_SLOTS = [0, 2, 4] as const;

export function isDjBoothSlot(clipIndex: number, clipCount = CLIP_COUNT): boolean {
  return DJ_BOOTH_SLOTS.includes((clipIndex % clipCount) as (typeof DJ_BOOTH_SLOTS)[number]);
}

/** Role-aware DJ-set casting: only the submitting DJ is ever in the booth. */
export function assignDjTurnClips(dj: CastFace, others: CastFace[], clipCount = CLIP_COUNT): DjClipCast[] {
  const dancers = others.filter((person) => person.id !== dj.id);
  return Array.from({ length: clipCount }, (_, i) => {
    if (isDjBoothSlot(i, clipCount)) {
      return { role: "booth" as const, person: dj };
    }
    if (dancers.length) {
      const dancer = dancers[Math.floor(i / 2) % dancers.length];
      return { role: "floor" as const, person: dancer };
    }
    return { role: "crowd" as const, person: null };
  });
}

export function djClipPrompt(input: {
  role: DjClipRole;
  person: CastFace | null;
  track: string;
  clipIndex: number;
  clipCount?: number;
}): string {
  const count = input.clipCount ?? CLIP_COUNT;
  const tail = `Nightclub music video, 16:9, cinematic, moving with the track: ${input.track}. Clip ${input.clipIndex + 1} of ${count}.`;
  if (input.role === "booth" && input.person) {
    return `Image 1 is ${input.person.display_name}, ${input.person.character_prompt}. Image 1 is ${input.person.display_name}, performing behind the DJ booth/mixer, DJing. They are the only DJ. ${tail}`;
  }
  if (input.role === "floor" && input.person) {
    return `Image 1 is ${input.person.display_name}, ${input.person.character_prompt}. Image 1 is ${input.person.display_name}, dancing on the club floor, NOT in the DJ booth. ${tail}`;
  }
  return `Anonymous packed dancefloor, bodies in motion, no specific face, NOT a close-up of someone DJing behind the decks. ${tail}`;
}

/**
 * House livestream: most clips are dancers (ready people on the floor).
 * Booth clips use the current resident holder when known — never a random human as DJ.
 */
export function assignHouseClip(
  seq: number,
  dancers: CastFace[],
  residents: CastFace[],
  opts?: { boothHolder?: CastFace | null; clipCount?: number },
): HouseClipCast {
  const clipCount = opts?.clipCount ?? CLIP_COUNT;
  const slot = Math.abs(seq) % clipCount;
  const boothSlot = slot === 0;
  if (boothSlot) {
    const holder = opts?.boothHolder ?? (residents.length ? residents[Math.abs(Math.floor(seq / clipCount)) % residents.length] : null);
    if (holder) return { role: "dj", person: holder };
    return { role: "dj", person: null };
  }
  if (dancers.length) {
    return { role: "dancer", person: dancers[Math.abs(seq) % dancers.length] };
  }
  const floorResidents = residents.filter((person) => person.id !== opts?.boothHolder?.id);
  const floorPool = floorResidents.length ? floorResidents : residents;
  if (floorPool.length) {
    return { role: "dancer", person: floorPool[Math.abs(seq) % floorPool.length] };
  }
  return { role: "crowd", person: null };
}

/** House takeover chat only when a human DJ set actually yields. */
export function shouldAnnounceHouseTakeover(previousKind: "house" | "dj" | null): boolean {
  return previousKind === "dj";
}
