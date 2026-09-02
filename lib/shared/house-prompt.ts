import { CLIP_COUNT } from "./constants";

export const HOUSE_VIBE =
  "midnight basement disco club livestream, wet concrete, fog, magenta and cyan lasers, cinematic 16:9, 10 seconds, 768P, analog film grain, no text";

const HOUSE_SHOTS = [
  "wide shot of the basement dancefloor from behind the booth",
  "slow push through dancers under a spinning disco ball",
  "low angle toward the decks, fog and light beams",
  "handheld crowd energy, flashing strobes",
  "close fog rolling across concrete walls and speakers",
  "wide bodies moving as one under the rig",
] as const;

export function houseClipPrompt(
  clipIndex: number,
  person?: { display_name: string; character_prompt: string } | null,
): string {
  const shot = HOUSE_SHOTS[clipIndex % HOUSE_SHOTS.length];
  const face = person
    ? `Image 1 is ${person.display_name}, ${person.character_prompt}. Keep them recognizable in the crowd or booth.`
    : "Anonymous packed dancefloor, no specific face.";
  return `${face} ${HOUSE_VIBE}. ${shot}. Clip ${clipIndex + 1} of ${CLIP_COUNT}.`;
}
