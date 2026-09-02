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
  "slow steadicam drift",
  "handheld in the crowd",
  "low angle toward the booth",
  "wide from the back wall",
  "push-in through fog",
  "over-the-shoulder of dancers",
] as const;

const MOODS = [
  "hot and humid, bodies moving as one",
  "cold blue haze, red practicals",
  "gold strobe freeze-frames",
  "magenta and cyan crosslight",
  "smoke so thick the lights become volumes",
  "sweaty close energy, shallow focus",
] as const;

export function houseClipPrompt(
  seq: number,
  person?: { display_name: string; character_prompt: string } | null,
): string {
  const theme = THEMES[Math.abs(seq) % THEMES.length];
  const camera = CAMERAS[Math.abs(Math.floor(seq / 3)) % CAMERAS.length];
  const mood = MOODS[Math.abs(Math.floor(seq / 5)) % MOODS.length];
  const face = person
    ? `Image 1 is ${person.display_name}, ${person.character_prompt}. Keep them recognizable in the crowd or booth.`
    : "Anonymous packed dancefloor, no specific face.";
  return `${face} ${HOUSE_VIBE}. Theme: ${theme}. Camera: ${camera}. Mood: ${mood}. Clip seed ${seq}.`;
}
