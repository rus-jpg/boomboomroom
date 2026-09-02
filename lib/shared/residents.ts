export const RESIDENT_SESSION_PREFIX = "resident:";

export type ResidentSeed = {
  slug: string;
  displayName: string;
  characterPrompt: string;
};

/** House crew — not real users. Stable slugs become session_token_hash keys. */
export const RESIDENT_SEEDS: ResidentSeed[] = [
  {
    slug: "neon-mira",
    displayName: "Neon Mira",
    characterPrompt:
      "Neon Mira, resident house DJ. Sharp chrome bangs, magenta underlights, silver ear cuffs, glossy club makeup, cinematic nightclub portrait, film still, 35mm, looking into camera.",
  },
  {
    slug: "basement-kev",
    displayName: "Basement Kev",
    characterPrompt:
      "Basement Kev, resident selector. Shaved head, gold tooth, vintage rave jacket, sweat sheen, warm tungsten and cyan bounce, cinematic basement portrait, 35mm film still.",
  },
  {
    slug: "vinyl-ghost",
    displayName: "Vinyl Ghost",
    characterPrompt:
      "Vinyl Ghost, resident booth spirit. Pale skin, translucent white hair, oversized headphones, faint motion blur, fog and disco-ball sparks, cinematic haunted-club portrait, 35mm.",
  },
  {
    slug: "acid-nori",
    displayName: "Acid Nori",
    characterPrompt:
      "Acid Nori, resident live-hardware DJ. Green-black hair, mesh top, 303 tattoo on the neck, lime and violet club lighting, cinematic portrait, film grain, 35mm.",
  },
  {
    slug: "low-end-lolo",
    displayName: "Low-End Lolo",
    characterPrompt:
      "Low-End Lolo, resident sub-bass architect. Box braids with fiber-optic tips, heavy gold rings, mirrored sunglasses indoors, deep red booth light, cinematic portrait, 35mm.",
  },
];

export function residentSessionHash(slug: string): string {
  return `${RESIDENT_SESSION_PREFIX}${slug}`;
}

export function isResidentSessionHash(hash: string): boolean {
  return hash.startsWith(RESIDENT_SESSION_PREFIX);
}
