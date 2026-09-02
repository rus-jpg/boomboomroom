import { RESIDENT_PORTRAIT_MODEL } from "@/lib/shared/constants";
import { RESIDENT_SEEDS, residentSessionHash } from "@/lib/shared/residents";
import { enqueueCharacter, hasRedis } from "./queues";
import { createResident, hasInflightCharacterJob, insertJob } from "./repo";

/** Seed resident DJs and enqueue portrait jobs until each has a character ref. */
export async function ensureResidents(): Promise<number> {
  let queued = 0;
  for (const seed of RESIDENT_SEEDS) {
    const person = await createResident({
      sessionHash: residentSessionHash(seed.slug),
      displayName: seed.displayName,
      characterPrompt: seed.characterPrompt,
    });
    if (person.character_reference_url && person.status === "ready") continue;
    if (await hasInflightCharacterJob(person.id)) continue;
    const job = await insertJob({
      kind: "character",
      participantId: person.id,
      payload: { resident: true, endpoint: RESIDENT_PORTRAIT_MODEL },
    });
    queued += 1;
    console.log(`[residents] portrait queued ${person.display_name} job=${job.id}`);
    if (hasRedis()) {
      try {
        await enqueueCharacter(job.id, person.id);
      } catch {
        // Worker DB claim loop picks it up.
      }
    }
  }
  return queued;
}
