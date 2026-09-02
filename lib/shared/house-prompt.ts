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

const CAMERAS = [
  "slow steadicam drift through dancing bodies",
  "handheld in the moving crowd",
  "low angle toward the dancing DJ in the booth",
  "wide from the back wall, packed floor moving",
  "push-in through fog onto dancers",
  "over-the-shoulder of people dancing",
] as const;

const MOODS = [
  "hot and humid, bodies dancing as one",
  "cold blue haze, red practicals, crowd in motion",
  "gold strobe freeze-frames of dancers",
  "magenta and cyan crosslight on moving bodies",
  "smoke so thick the lights become volumes over the dancefloor",
  "sweaty close energy, people dancing, shallow focus",
] as const;

const ACTIONS = [
  "people dancing hard, arms up, four-on-the-floor pulse in the bodies",
  "resident DJ performing behind the decks, nodding, hands on the mixer",
  "crowd jumping and swaying, bass hitting chests",
  "couple dancing close under the disco ball",
  "DJ dropping a drop, booth erupting, dancers reacting",
  "hands in the air, camera weaving between dancers",
] as const;

const MUSIC_BEDS = [
  "Genre: midnight basement disco. BPM: 118. Four-on-the-floor analog kick, dusty hats, rubber bass, instrumental, no vocals.",
  "Genre: deep house. BPM: 122. Wet concrete club, subby kick, filtered stabs, late-night instrumental.",
  "Genre: techno. BPM: 132. Warehouse pressure, rolling hats, industrial space, instrumental.",
  "Genre: acid house. BPM: 124. 303 squelch, basement rave, sweaty and hypnotic, instrumental.",
  "Genre: UK garage-leaning house. BPM: 130. Shuffled hats, warm bass, night-bus glow, instrumental.",
] as const;

export function houseClipPrompt(
  seq: number,
  person?: { display_name: string; character_prompt: string } | null,
): string {
  const theme = THEMES[Math.abs(seq) % THEMES.length];
  const camera = CAMERAS[Math.abs(Math.floor(seq / 3)) % CAMERAS.length];
  const mood = MOODS[Math.abs(Math.floor(seq / 5)) % MOODS.length];
  const action = ACTIONS[Math.abs(seq) % ACTIONS.length];
  const face = person
    ? `Image 1 is ${person.display_name}, ${person.character_prompt}. Keep them recognizable, dancing or DJing in the booth or on the floor.`
    : "Anonymous packed dancefloor, bodies in motion, no specific face.";
  return `${face} ${HOUSE_VIBE}. Theme: ${theme}. Camera: ${camera}. Mood: ${mood}. Action: ${action}. Dancing bodies, DJ performance, crowd moving. Clip seed ${seq}.`;
}

export function houseMusicPrompt(seq: number): string {
  return MUSIC_BEDS[Math.abs(seq) % MUSIC_BEDS.length];
}
