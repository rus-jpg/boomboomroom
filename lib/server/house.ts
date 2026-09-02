import { randomUUID } from "node:crypto";
import { CLIP_COUNT } from "@/lib/shared/constants";
import {
  clipAllowedForHolder,
  countHolderReadyClips,
  isBoothHouseJob,
  selectHouseTurnClips,
} from "@/lib/shared/house-clips";
import { houseClipPrompt, houseMusicPrompt } from "@/lib/shared/house-prompt";
import { isPlayableAudioUrl, isPlayableVideoUrl, isStubHouseAudio, isStubHouseVideo } from "@/lib/shared/media";
import { assignHouseClip, asCastFace, stageCastPool, type CastFace, type HouseClipRole } from "@/lib/shared/stage-cast";
import { enqueueMusic, enqueueVideo, hasRedis, publishRoomEvent } from "./queues";
import {
  claimHouseClipsByIds,
  countUnusedHouseAudio,
  getRoomBySlug,
  insertJob,
  latestHouseTurn,
  latestPlayingTurn,
  listInflightHouseMusicJobs,
  listInflightHouseVideoJobs,
  listMediaByKind,
  listMediaByStorageKeys,
  listPresentReadyParticipants,
  listResidents,
  getParticipant,
  listUnusedHouseClips,
  claimUnusedHouseAudio,
  releaseHouseClips,
  updateTurn,
} from "./repo";
import { pickNextResident } from "@/lib/shared/resident-booth";

const AHEAD_UNUSED = CLIP_COUNT;
const TARGET_POOL = 12;
const MAX_INFLIGHT = 6;
const MUSIC_AHEAD = 2;
const MAX_MUSIC_INFLIGHT = 2;
/** Want a full set of booth slots for the labeled holder before filling dancers. */
const BOOTH_AHEAD = 3;

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

export function isHouseJob(job: { kind: string; payload: unknown; turn_id?: string | null }): boolean {
  return (job.payload as { house?: boolean } | null)?.house === true;
}

function withFaceRef<T extends { character_reference_url: string | null; status: string }>(p: T) {
  return Boolean(p.character_reference_url) && p.status === "ready";
}

/** Residents always + humans with live presence. Absent humans are not cast. */
async function houseCastRoster(): Promise<{ residents: CastFace[]; pool: CastFace[] }> {
  const room = await getRoomBySlug();
  const [present, residents] = await Promise.all([listPresentReadyParticipants(room.id), listResidents()]);
  const residentFaces = residents.filter(withFaceRef).map(asCastFace);
  const presentHumans = present.filter((p) => withFaceRef(p) && !p.is_resident).map(asCastFace);
  const pool = stageCastPool(residentFaces, presentHumans);
  return { residents: residentFaces, pool };
}

async function currentHouseBoothHolder(): Promise<CastFace | null> {
  const { residents } = await houseCastRoster();
  const room = await getRoomBySlug();
  const [playing, lastHouse] = await Promise.all([latestPlayingTurn(room.id), latestHouseTurn(room.id)]);
  const currentId = playing?.kind === "house" ? playing.dj_participant_id : lastHouse?.dj_participant_id ?? null;
  return (
    (currentId ? residents.find((person) => person.id === currentId) : null) ??
    pickNextResident(residents, lastHouse?.dj_participant_id ?? null)
  );
}

function playableHouseRows<T extends { storage_key: string }>(rows: T[]): T[] {
  return rows.filter((row) => isPlayableVideoUrl(row.storage_key));
}

/**
 * Unused clips first (consumed), then replay holder-safe clips.
 * Never attaches another person's booth/DJ take to this holder.
 */
export async function takeHouseClipKeys(
  count: number,
  turnId: string,
  holderId?: string | null,
): Promise<string[]> {
  if (count <= 0) return [];
  const unused = playableHouseRows(await listUnusedHouseClips(48));
  const picked = selectHouseTurnClips(unused, holderId ?? null, count);
  const claimed = await claimHouseClipsByIds(picked.claimIds, turnId);
  const claimedKeys = new Set(claimed.map((row) => row.storage_key).filter((key) => isPlayableVideoUrl(key)));
  const keys = picked.keys.filter((key) => claimedKeys.has(key));
  if (keys.length >= count) return keys.slice(0, count);

  const pool = playableHouseRows(await listMediaByKind("house_video", 48)).filter(
    (row) => clipAllowedForHolder(row, holderId ?? null) && !claimedKeys.has(row.storage_key),
  );
  const replay = selectHouseTurnClips(pool, holderId ?? null, count);
  const out = [...keys];
  for (const key of replay.keys) {
    if (out.length >= count) break;
    if (isPlayableVideoUrl(key)) out.push(key);
  }
  return out.slice(0, count);
}

export async function takeHouseAudioKey(turnId: string): Promise<string | null> {
  const claimed = await claimUnusedHouseAudio(1, turnId);
  const fromClaim = claimed[0]?.storage_key;
  if (fromClaim && isPlayableAudioUrl(fromClaim)) return fromClaim;
  const pool = await listMediaByKind("house_audio", 12);
  const row = pool.find((item) => isPlayableAudioUrl(item.storage_key));
  return row?.storage_key ?? null;
}

export async function latestHouseClipKeys(count = CLIP_COUNT, holderId?: string | null): Promise<string[]> {
  const unusedRows = playableHouseRows(await listUnusedHouseClips(48));
  const picked = selectHouseTurnClips(unusedRows, holderId ?? null, count);
  if (picked.keys.length >= count) return picked.keys.slice(0, count);
  const rows = playableHouseRows(await listMediaByKind("house_video", 48));
  const extra = selectHouseTurnClips(
    rows.filter((row) => !picked.keys.includes(row.storage_key)),
    holderId ?? null,
    count - picked.keys.length,
  );
  return [...picked.keys, ...extra.keys].slice(0, count);
}

async function queueHouseClipJob(input: {
  batchId: string;
  clipIndex: number;
  seq: number;
  role: HouseClipRole;
  featured: CastFace | null;
}): Promise<void> {
  const job = await insertJob({
    kind: "video",
    turnId: null,
    participantId: input.featured?.id ?? null,
    payload: {
      house: true,
      house_clip: true,
      batchId: input.batchId,
      clipIndex: input.clipIndex,
      seq: input.seq,
      role: input.role,
      prompt: houseClipPrompt(input.seq, input.featured, input.role),
      referenceImageUrl: input.featured?.character_reference_url ?? null,
    },
  });
  console.log(
    `[house] house_clip queued ${job.id} seq=${input.seq} role=${input.role} face=${input.featured?.display_name ?? (input.role === "dj" ? "anon-booth" : "crowd")}`,
  );
  if (hasRedis()) {
    try {
      await enqueueVideo(job.id, "house", input.clipIndex);
    } catch {
      // Worker DB claim loop picks queued house jobs.
    }
  }
}

async function ensureHouseVideoJobsQueued(): Promise<number> {
  const unusedRows = playableHouseRows(await listUnusedHouseClips(48));
  const inflight = await listInflightHouseVideoJobs();
  const { pool, residents } = await houseCastRoster();
  const boothHolder = await currentHouseBoothHolder();
  const holderId = boothHolder?.id ?? null;
  const counts = countHolderReadyClips(unusedRows, holderId);
  const inflightBooth = inflight.filter(
    (job) => isBoothHouseJob(job) && (!holderId || job.participant_id === holderId),
  ).length;
  const inflightFloor = inflight.length - inflight.filter((job) => isBoothHouseJob(job)).length;

  let boothNeed = Math.max(0, BOOTH_AHEAD - counts.booth - inflightBooth);
  let floorNeed = Math.max(0, AHEAD_UNUSED - counts.floor - inflightFloor);
  if (counts.allowed + inflight.length < TARGET_POOL) {
    const extra = TARGET_POOL - counts.allowed - inflight.length;
    if (counts.booth + inflightBooth < BOOTH_AHEAD) {
      boothNeed = Math.max(boothNeed, Math.min(extra, BOOTH_AHEAD - counts.booth - inflightBooth));
    }
    floorNeed = Math.max(floorNeed, extra - boothNeed);
  }

  let need = Math.min(boothNeed + floorNeed, Math.max(0, MAX_INFLIGHT - inflight.length));
  if (need <= 0) return 0;

  const batchId = randomUUID();
  const seqBase = Date.now();
  let queuedBooth = 0;

  for (let i = 0; i < need; i++) {
    const seq = seqBase + i;
    const wantBooth = queuedBooth < boothNeed && Boolean(boothHolder);
    if (wantBooth && boothHolder) {
      await queueHouseClipJob({
        batchId,
        clipIndex: i,
        seq,
        role: "dj",
        featured: boothHolder,
      });
      queuedBooth += 1;
      continue;
    }
    const floor = pool.filter((person) => person.id !== boothHolder?.id);
    const { role, person: featured } = assignHouseClip(seq, floor, residents, { boothHolder });
    const safeRole: HouseClipRole = role === "dj" && featured && holderId && featured.id !== holderId ? "dancer" : role;
    const safeFace = safeRole === "dj" ? (boothHolder ?? featured) : featured;
    await queueHouseClipJob({
      batchId,
      clipIndex: i,
      seq,
      role: safeRole,
      featured: safeFace,
    });
    if (safeRole === "dj") queuedBooth += 1;
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

/** Keep unused H3 Max clips and Music 3 beds ahead. Independent of DJ music. */
export async function ensureHouseJobsQueued(): Promise<number> {
  const videos = await ensureHouseVideoJobsQueued();
  const beds = await ensureHouseMusicJobsQueued();
  return videos + beds;
}

export async function houseSetLabel(residentName?: string | null): Promise<string> {
  if (residentName) return `Resident set · ${residentName}`;
  const room = await getRoomBySlug();
  const playing = await latestPlayingTurn(room.id);
  if (playing?.kind === "house" && playing.dj_participant_id) {
    const holder = await getParticipant(playing.dj_participant_id);
    if (holder?.display_name) return `Resident set · ${holder.display_name}`;
  }
  const residents = (await listResidents()).filter((p) => p.status === "ready");
  if (!residents.length) return "House buffer — midnight basement disco";
  return `Resident set · ${residents[0].display_name}`;
}

/** Attach holder-safe H3 Max clips + Music 3 beds to a playing house turn that is empty or still on stubs. */
export async function hydratePlayingHouseTurn(): Promise<boolean> {
  const room = await getRoomBySlug();
  const playing = await latestPlayingTurn(room.id);
  if (!playing || playing.kind !== "house") return false;
  const holderId = playing.dj_participant_id;
  const current = asStringArray(playing.video_segment_urls);
  const mediaRows = await listMediaByStorageKeys(current);
  const byKey = new Map(mediaRows.map((row) => [row.storage_key, row]));
  const kept: string[] = [];
  for (const url of current) {
    if (!isPlayableVideoUrl(url) || isStubHouseVideo(url)) continue;
    const row = byKey.get(url);
    if (row && !clipAllowedForHolder(row, holderId)) continue;
    if (!kept.includes(url)) kept.push(url);
  }

  const unused = playableHouseRows(await listUnusedHouseClips(48)).filter((row) =>
    clipAllowedForHolder(row, holderId),
  );
  const currentRows = mediaRows.filter((row) => kept.includes(row.storage_key));
  const candidates = [...currentRows, ...unused];
  const picked = selectHouseTurnClips(candidates, holderId, CLIP_COUNT);
  if (picked.claimIds.length) {
    await claimHouseClipsByIds(picked.claimIds, playing.id);
  }
  const nextKeys = picked.keys.length ? picked.keys : kept;

  const patch: { video_segment_urls?: string[]; audio_url?: string; music_prompt?: string } = {};

  if (nextKeys.join("\0") !== current.join("\0")) {
    patch.video_segment_urls = nextKeys.slice(0, CLIP_COUNT);
    const dropped = mediaRows.filter((row) => current.includes(row.storage_key) && !nextKeys.includes(row.storage_key));
    if (dropped.length) await releaseHouseClips(dropped.map((row) => row.id), playing.id);
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
