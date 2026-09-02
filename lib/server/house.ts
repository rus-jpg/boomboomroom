import { randomUUID } from "node:crypto";
import { CLIP_COUNT } from "@/lib/shared/constants";
import { houseClipPrompt, houseMusicPrompt } from "@/lib/shared/house-prompt";
import { isPlayableAudioUrl, isPlayableVideoUrl, isStubHouseAudio, isStubHouseVideo } from "@/lib/shared/media";
import { enqueueMusic, enqueueVideo, hasRedis, publishRoomEvent } from "./queues";
import {
  claimUnusedHouseAudio,
  claimUnusedHouseClips,
  countUnusedHouseAudio,
  countUnusedHouseClips,
  getRoomBySlug,
  insertJob,
  latestPlayingTurn,
  listInflightHouseMusicJobs,
  listInflightHouseVideoJobs,
  listMediaByKind,
  listReadyParticipants,
  listResidents,
  listUnusedHouseClips,
  updateTurn,
} from "./repo";

const AHEAD_UNUSED = CLIP_COUNT;
const TARGET_POOL = 12;
const MAX_INFLIGHT = 6;
const MUSIC_AHEAD = 2;
const MAX_MUSIC_INFLIGHT = 2;

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

export function isHouseJob(job: { kind: string; payload: unknown; turn_id?: string | null }): boolean {
  return (job.payload as { house?: boolean } | null)?.house === true;
}

async function houseReferenceRoster() {
  const ready = await listReadyParticipants();
  const withRef = ready.filter((p) => p.character_reference_url);
  const residents = withRef.filter((p) => p.is_resident);
  const humans = withRef.filter((p) => !p.is_resident);
  return residents.length || humans.length ? [...residents, ...humans] : withRef;
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

export async function takeHouseAudioKey(turnId: string): Promise<string | null> {
  const claimed = await claimUnusedHouseAudio(1, turnId);
  const fromClaim = claimed[0]?.storage_key;
  if (fromClaim && isPlayableAudioUrl(fromClaim)) return fromClaim;
  const pool = await listMediaByKind("house_audio", 12);
  const row = pool.find((item) => isPlayableAudioUrl(item.storage_key));
  return row?.storage_key ?? null;
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

async function ensureHouseVideoJobsQueued(): Promise<number> {
  const unused = await countUnusedHouseClips();
  const inflight = await listInflightHouseVideoJobs();
  let need = 0;
  if (unused < AHEAD_UNUSED) need = Math.max(need, AHEAD_UNUSED - unused);
  if (unused + inflight.length < TARGET_POOL) {
    need = Math.max(need, TARGET_POOL - unused - inflight.length);
  }
  need = Math.min(need, Math.max(0, MAX_INFLIGHT - inflight.length));
  if (need <= 0) return 0;

  const roster = await houseReferenceRoster();
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
    console.log(`[house] house_clip queued ${job.id} seq=${seqBase + i} face=${featured?.display_name ?? "crowd"}`);
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

async function ensureHouseMusicJobsQueued(): Promise<number> {
  const unused = await countUnusedHouseAudio();
  const inflight = await listInflightHouseMusicJobs();
  let need = 0;
  if (unused < MUSIC_AHEAD) need = Math.max(need, MUSIC_AHEAD - unused);
  need = Math.min(need, Math.max(0, MAX_MUSIC_INFLIGHT - inflight.length));
  if (need <= 0) return 0;

  const seqBase = Date.now();
  for (let i = 0; i < need; i++) {
    const prompt = houseMusicPrompt(seqBase + i);
    const job = await insertJob({
      kind: "music",
      turnId: null,
      payload: {
        house: true,
        house_bed: true,
        seq: seqBase + i,
        prompt,
        lyrics: "[instrumental]",
      },
    });
    console.log(`[house] house_bed queued ${job.id}`);
    if (hasRedis()) {
      try {
        await enqueueMusic(job.id, "house");
      } catch {
        // Worker DB claim loop picks queued house beds.
      }
    }
  }
  return need;
}

/** Keep ≥6 unused H3 Max clips and Music 3 beds ahead. Independent of DJ music. */
export async function ensureHouseJobsQueued(): Promise<number> {
  const videos = await ensureHouseVideoJobsQueued();
  const beds = await ensureHouseMusicJobsQueued();
  return videos + beds;
}

export async function houseSetLabel(): Promise<string> {
  const residents = (await listResidents()).filter((p) => p.status === "ready");
  if (!residents.length) return "House buffer — midnight basement disco";
  const names = residents.slice(0, 3).map((p) => p.display_name).join(", ");
  return `Resident set · ${names}`;
}

/** Attach H3 Max clips + Music 3 beds to a playing house turn that is empty or still on stubs. */
export async function hydratePlayingHouseTurn(): Promise<boolean> {
  const room = await getRoomBySlug();
  const playing = await latestPlayingTurn(room.id);
  if (!playing || playing.kind !== "house") return false;
  const current = asStringArray(playing.video_segment_urls);
  const playable = current.filter((url) => isPlayableVideoUrl(url) && !isStubHouseVideo(url));
  const patch: { video_segment_urls?: string[]; audio_url?: string; music_prompt?: string } = {};

  if (playable.length < CLIP_COUNT) {
    const extra = await takeHouseClipKeys(CLIP_COUNT - playable.length, playing.id);
    const keys = [...playable];
    for (const key of extra) {
      if (keys.length >= CLIP_COUNT) break;
      if (!keys.includes(key)) keys.push(key);
    }
    if (keys.length && keys.length !== playable.length) patch.video_segment_urls = keys;
  }

  if (isStubHouseAudio(playing.audio_url)) {
    const audio = await takeHouseAudioKey(playing.id);
    if (audio) patch.audio_url = audio;
  }

  if (!playing.music_prompt || playing.music_prompt.startsWith("House buffer")) {
    patch.music_prompt = await houseSetLabel();
  }

  if (!Object.keys(patch).length) return false;
  await updateTurn(playing.id, patch);
  await publishRoomEvent({ type: "house-hydrated", turnId: playing.id });
  console.log(`[house] hydrated turn ${playing.id}`, Object.keys(patch).join(","));
  return true;
}
