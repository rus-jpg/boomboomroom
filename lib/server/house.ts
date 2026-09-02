import { randomUUID } from "node:crypto";
import { CLIP_COUNT } from "@/lib/shared/constants";
import { houseClipPrompt } from "@/lib/shared/house-prompt";
import { isPlayableVideoUrl, isStubHouseVideo } from "@/lib/shared/media";
import { enqueueVideo, hasRedis, publishRoomEvent } from "./queues";
import {
  claimUnusedHouseClips,
  countUnusedHouseClips,
  getRoomBySlug,
  insertJob,
  latestPlayingTurn,
  listInflightHouseVideoJobs,
  listMediaByKind,
  listReadyParticipants,
  listUnusedHouseClips,
  updateTurn,
} from "./repo";

const AHEAD_UNUSED = CLIP_COUNT;
const TARGET_POOL = 12;
const MAX_INFLIGHT = 6;

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

export function isHouseJob(job: { kind: string; payload: unknown; turn_id?: string | null }): boolean {
  return job.kind === "video" && (job.payload as { house?: boolean } | null)?.house === true;
}

/** Unused clips first (consumed), then replay any H3 Max house clip. Never stubs if any real clip exists. */
export async function takeHouseClipKeys(count: number, turnId: string): Promise<string[]> {
  const claimed = await claimUnusedHouseClips(count, turnId);
  const keys = claimed.map((row) => row.storage_key).filter((key) => isPlayableVideoUrl(key));
  if (keys.length >= count) return keys.slice(0, count);

  const pool = await listMediaByKind("house_video", 48);
  for (const row of pool) {
    if (keys.length >= count) break;
    if (!isPlayableVideoUrl(row.storage_key)) continue;
    if (keys.includes(row.storage_key)) continue;
    keys.push(row.storage_key);
  }
  return keys;
}

export async function latestHouseClipKeys(count = CLIP_COUNT): Promise<string[]> {
  const unusedRows = await listUnusedHouseClips(count);
  const unusedKeys = unusedRows.map((row) => row.storage_key).filter((key) => isPlayableVideoUrl(key));
  if (unusedKeys.length >= count) return unusedKeys.slice(0, count);
  const rows = await listMediaByKind("house_video", 48);
  const keys = [...unusedKeys];
  for (const row of rows) {
    if (keys.length >= count) break;
    if (!isPlayableVideoUrl(row.storage_key) || keys.includes(row.storage_key)) continue;
    keys.push(row.storage_key);
  }
  return keys;
}

/** Keep ≥6 unused clips ahead of the playhead and refill toward 12. Independent of DJ music. */
export async function ensureHouseJobsQueued(): Promise<number> {
  const unused = await countUnusedHouseClips();
  const inflight = await listInflightHouseVideoJobs();
  let need = 0;
  if (unused < AHEAD_UNUSED) need = Math.max(need, AHEAD_UNUSED - unused);
  if (unused + inflight.length < TARGET_POOL) {
    need = Math.max(need, TARGET_POOL - unused - inflight.length);
  }
  need = Math.min(need, Math.max(0, MAX_INFLIGHT - inflight.length));
  if (need <= 0) return 0;

  const roster = (await listReadyParticipants()).filter((p) => p.character_reference_url);
  const batchId = randomUUID();
  const seqBase = Date.now();

  for (let i = 0; i < need; i++) {
    const featured = roster.length ? roster[(unused + inflight.length + i) % roster.length] : null;
    const job = await insertJob({
      kind: "video",
      turnId: null,
      participantId: featured?.id ?? null,
      payload: {
        house: true,
        house_clip: true,
        batchId,
        clipIndex: i,
        seq: seqBase + i,
        prompt: houseClipPrompt(seqBase + i, featured),
        referenceImageUrl: featured?.character_reference_url ?? null,
      },
    });
    console.log(`[house] house_clip queued ${job.id} seq=${seqBase + i}`);
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

/** Attach H3 Max clips to a playing house turn that is empty or still on stubs. */
export async function hydratePlayingHouseTurn(): Promise<boolean> {
  const room = await getRoomBySlug();
  const playing = await latestPlayingTurn(room.id);
  if (!playing || playing.kind !== "house") return false;
  const current = asStringArray(playing.video_segment_urls);
  const playable = current.filter((url) => isPlayableVideoUrl(url) && !isStubHouseVideo(url));
  if (playable.length >= CLIP_COUNT) return false;
  const extra = await takeHouseClipKeys(CLIP_COUNT - playable.length, playing.id);
  const keys = [...playable];
  for (const key of extra) {
    if (keys.length >= CLIP_COUNT) break;
    if (!keys.includes(key)) keys.push(key);
  }
  if (!keys.length || keys.length === playable.length) return false;
  await updateTurn(playing.id, { video_segment_urls: keys });
  await publishRoomEvent({ type: "house-hydrated", turnId: playing.id });
  console.log(`[house] hydrated turn ${playing.id} with ${keys.length} H3 Max clip(s)`);
  return true;
}
