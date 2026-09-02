import { randomUUID } from "node:crypto";
import { CLIP_COUNT } from "@/lib/shared/constants";
import { houseClipPrompt } from "@/lib/shared/house-prompt";
import { isPlayableVideoUrl } from "@/lib/shared/media";
import { enqueueVideo, hasRedis } from "./queues";
import {
  insertJob,
  listInflightHouseVideoJobs,
  listMediaByKind,
  listReadyParticipants,
} from "./repo";

const TARGET_READY = CLIP_COUNT;
const TARGET_POOL = 12;
const MAX_INFLIGHT = 6;

export async function latestHouseClipKeys(count = CLIP_COUNT): Promise<string[]> {
  const rows = await listMediaByKind("house_video", count);
  const keys = rows
    .map((row) => row.storage_key)
    .filter((key) => isPlayableVideoUrl(key))
    .reverse();
  return keys.slice(0, count);
}

/** Keep ≥6 ready H3 Max house clips (and refill toward 12) without blocking on fal. */
export async function ensureHouseJobsQueued(): Promise<number> {
  const ready = await latestHouseClipKeys(TARGET_POOL);
  const inflight = await listInflightHouseVideoJobs();
  let need = 0;
  if (ready.length < TARGET_READY) need = Math.max(need, TARGET_READY - ready.length);
  if (ready.length + inflight.length < TARGET_POOL) {
    need = Math.max(need, TARGET_POOL - ready.length - inflight.length);
  }
  need = Math.min(need, Math.max(0, MAX_INFLIGHT - inflight.length));
  if (need <= 0) return 0;

  const roster = (await listReadyParticipants()).filter((p) => p.character_reference_url);
  const batchId = randomUUID();
  const offset = ready.length + inflight.length;

  for (let i = 0; i < need; i++) {
    const featured = roster.length ? roster[(offset + i) % roster.length] : null;
    const job = await insertJob({
      kind: "video",
      turnId: null,
      participantId: featured?.id ?? null,
      payload: {
        house: true,
        batchId,
        clipIndex: i,
        prompt: houseClipPrompt(i, featured),
        referenceImageUrl: featured?.character_reference_url ?? null,
      },
    });
    if (hasRedis()) {
      try {
        await enqueueVideo(job.id, "house", i);
      } catch {
        // Worker DB claim loop picks queued house jobs.
      }
    }
  }
  return need;
}
