import type { CastFace, HouseClipRole } from "./stage-cast";

export const HOUSE_VIBE =
  "midnight basement disco club livestream, wet concrete, fog, magenta and cyan lasers, cinematic 16:9, 10 seconds, 768P, analog film grain, no text, no logos";

const THEMES = [
  "midnight basement disco",
  "neon sweat on the dancefloor",
  "fog and lasers cutting the dark",
  "crowd silhouettes under a disco ball",
  "close on the DJ booth and mixer",
  "wet concrete reflecting club lights",
  "strobe-lit underground rave",
  "packed illegal basement party",
] as const;

const DANCER_CAMERAS = [
  "slow steadicam drift through dancing bodies",
  "handheld in the moving crowd",
  "wide from the back wall, packed floor moving",
  "push-in through fog onto dancers",
  "over-the-shoulder of people dancing",
  "low angle across the dancefloor, booth out of focus in the distance",
] as const;

const DJ_CAMERAS = [
  "low angle toward the resident DJ in the booth",
  "tight on hands on the mixer, resident performing",
  "side of the booth, decks and resident DJ in frame",
] as const;

const DANCER_MOODS = [
  "hot and humid, bodies dancing as one",
  "cold blue haze, red practicals, crowd in motion",
  "gold strobe freeze-frames of dancers",
  "magenta and cyan crosslight on moving bodies",
  "smoke so thick the lights become volumes over the dancefloor",
  "sweaty close energy, people dancing, shallow focus",
] as const;

const DJ_MOODS = [
  "booth practicals, magenta and cyan on the mixer",
  "tight booth heat, resident locked to the groove",
  "fog rolling over the decks, resident in control",
] as const;

const DANCER_ACTIONS = [
  "people dancing hard, arms up, four-on-the-floor pulse in the bodies",
  "crowd jumping and swaying, bass hitting chests",
  "couple dancing close under the disco ball",
  "hands in the air, camera weaving between dancers",
] as const;

const DJ_ACTIONS = [
  "resident DJ performing behind the decks, nodding, hands on the mixer",
  "resident dropping a drop from the booth, dancers reacting on the floor",
] as const;

const MUSIC_BEDS = [
  "Genre: midnight basement disco. BPM: 118. Four-on-the-floor analog kick, dusty hats, rubber bass, instrumental, no vocals.",
  "Genre: deep house. BPM: 122. Wet concrete club, subby kick, filtered stabs, late-night instrumental.",
  "Genre: techno. BPM: 132. Warehouse pressure, rolling hats, industrial space, instrumental.",
  "Genre: acid house. BPM: 124. 303 squelch, basement rave, sweaty and hypnotic, instrumental.",
  "Genre: UK garage-leaning house. BPM: 130. Shuffled hats, warm bass, night-bus glow, instrumental.",
] as const;

function pick<T>(items: readonly T[], n: number): T {
  return items[Math.abs(n) % items.length];
}

export function houseClipPrompt(
  seq: number,
  person?: Pick<CastFace, "display_name" | "character_prompt"> | null,
  role: HouseClipRole = person ? "dancer" : "crowd",
): string {
  const theme = pick(THEMES, seq);
  const isBooth = role === "dj";
  const camera = isBooth ? pick(DJ_CAMERAS, seq) : pick(DANCER_CAMERAS, Math.floor(seq / 3));
  const mood = isBooth ? pick(DJ_MOODS, Math.floor(seq / 5)) : pick(DANCER_MOODS, Math.floor(seq / 5));
  const action = isBooth ? pick(DJ_ACTIONS, seq) : pick(DANCER_ACTIONS, seq);

  let face: string;
  if (role === "dj" && person) {
    face = `Image 1 is ${person.display_name}, ${person.character_prompt}. Image 1 is ${person.display_name}, the resident DJ performing behind the DJ booth/mixer, DJing. Keep them recognizable.`;
  } else if (role === "dancer" && person) {
    face = `Image 1 is ${person.display_name}, ${person.character_prompt}. Image 1 is ${person.display_name}, dancing on the club floor, NOT in the DJ booth. Keep them recognizable.`;
  } else if (role === "dj") {
    face = "Anonymous DJ booth, hands on the mixer, no recognizable face.";
  } else {
    face = "Anonymous packed dancefloor, bodies in motion, no specific face.";
  }

  const closing = isBooth
    ? "Resident DJ performance in the booth. Clip seed"
    : "Dancing bodies on the floor, not behind the decks. Clip seed";

  return `${face} ${HOUSE_VIBE}. Theme: ${theme}. Camera: ${camera}. Mood: ${mood}. Action: ${action}. ${closing} ${seq}.`;
}

export function houseMusicPrompt(seq: number): string {
  return MUSIC_BEDS[Math.abs(seq) % MUSIC_BEDS.length];
}
