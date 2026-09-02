import { Worker } from "bullmq";
import { createServer } from "node:http";
import Redis from "ioredis";
import { QUEUES } from "@/lib/shared/constants";
import { isMockMode, redisUrl } from "@/lib/server/env";
import { ensureHouseJobsQueued, hydratePlayingHouseTurn, isHouseJob } from "@/lib/server/house";
import { pollFalQueue, submitCharacter, submitMusic, submitResidentPortrait, submitVideo } from "@/lib/server/fal";
import { ensureResidents } from "@/lib/server/residents";
import { isResidentJobPayload } from "@/lib/shared/residents";
import { publishRoomEvent } from "@/lib/server/queues";
import {
  claimQueuedJob,
  getJob,
  getParticipant,
  insertMedia,
  listCompleteHouseJobs,
  listGeneratingTurns,
  listQueuedJobs,
  listRunningFalJobs,
  listStuckRunningJobs,
  updateJob,
  updateParticipant,
} from "@/lib/server/repo";
import { redisConnection } from "@/lib/server/redis";
import { signedUrl, uploadBytes } from "@/lib/server/storage";
import { ensureHouseMediaStored, finalizeTurn, ingestFalWebhook } from "./ingest";
import { mockCharacterJpeg } from "./mock";

const RECLAIM_MS = 12_000;
const FACE_SIGNED_TTL_S = 60 * 60 * 24;
const ORPHAN_CLAIM_MS = 45_000;

/** Job ids this process claimed and has not yet written fal_request_id for. */
const inFlightClaims = new Set<string>();
const orphanFirstSeen = new Map<string, number>();

function houseFirst<T extends { kind: string; payload: unknown }>(jobs: T[]): T[] {
  const house = jobs.filter((job) => isHouseJob(job));
  const rest = jobs.filter((job) => !isHouseJob(job));
  return [...house, ...rest];
}

async function takeQueued(jobId: string) {
  const current = await getJob(jobId);
  if (!current) return null;
  if (current.status === "complete" || current.status === "failed" || current.fal_request_id) return null;
  if (current.status !== "queued") return null;
  const claimed = await claimQueuedJob(jobId);
  if (claimed) inFlightClaims.add(claimed.id);
  return claimed;
}

async function releaseClaim(jobId: string) {
  inFlightClaims.delete(jobId);
}

async function requeueClaim(jobId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await updateJob(jobId, { status: "queued", error: message, fal_request_id: null });
  inFlightClaims.delete(jobId);
}

async function handleCharacter(jobId: string) {
  const job = await takeQueued(jobId);
  if (!job || !job.participant_id) return;
  try {
    const person = await getParticipant(job.participant_id);
    if (!person) {
      await updateJob(job.id, {
        status: "failed",
        error: "participant missing",
        completed_at: new Date().toISOString(),
      });
      return;
    }

    const isResident = person.is_resident || isResidentJobPayload(job.payload);
    const faceKey = person.original_face_url;
    const faceUrl = faceKey ? (await signedUrl(faceKey, FACE_SIGNED_TTL_S)) || faceKey : "";
    const imageUrl = faceUrl.startsWith("http") ? faceUrl : "";
    if (!isMockMode() && !imageUrl && !isResident) {
      await updateJob(job.id, {
        status: "failed",
        error: "face image is not publicly fetchable for fal",
        completed_at: new Date().toISOString(),
      });
      return;
    }
    const submitted = isResident
      ? await submitResidentPortrait({ prompt: person.character_prompt, jobId: job.id })
      : await submitCharacter({
          imageUrl: imageUrl || "https://fal.media/files/placeholder.jpg",
          prompt: person.character_prompt,
          jobId: job.id,
        });
    await updateJob(job.id, { fal_request_id: submitted.requestId });

    if (submitted.mock) {
      const svg = mockCharacterJpeg(person.display_name, person.character_prompt);
      const key = `characters/${person.id}.svg`;
      const storageKey = await uploadBytes("media", key, svg, "image/svg+xml");
      await insertMedia({
        kind: "character",
        storageKey,
        contentType: "image/svg+xml",
        participantId: person.id,
      });
      await updateParticipant(person.id, {
        character_reference_url: storageKey,
        status: "ready",
      });
      await updateJob(job.id, { status: "complete", completed_at: new Date().toISOString(), result: { mock: true, storageKey } });
      await publishRoomEvent({ type: "character-ready", participantId: person.id });
    }
  } catch (err) {
    await requeueClaim(job.id, err);
    console.error(`[worker] submit ${job.id}`, err);
  } finally {
    releaseClaim(job.id);
  }
}

async function handleMusic(jobId: string) {
  const job = await takeQueued(jobId);
  if (!job) return;
  try {
    const payload = (job.payload ?? {}) as { prompt?: string; lyrics?: string; house?: boolean };
    const isHouse = payload.house === true;
    if (!isHouse && !job.turn_id) {
      await updateJob(job.id, {
        status: "failed",
        error: "music job missing turn",
        completed_at: new Date().toISOString(),
      });
      return;
    }
    const submitted = await submitMusic({
      prompt: payload.prompt || "Genre: midnight disco. BPM: 118.",
      lyrics: payload.lyrics,
      jobId: job.id,
    });
    await updateJob(job.id, { fal_request_id: submitted.requestId });
    if (isHouse) {
      console.log(`[worker] house_bed submit ${job.id} fal=${submitted.requestId} mock=${submitted.mock}`);
    }
    if (submitted.mock) {
      await updateJob(job.id, {
        status: "complete",
        completed_at: new Date().toISOString(),
        result: { mock: true, house: isHouse, audio: { url: "/house/house-audio.mp3" }, duration: 60 },
      });
      if (!isHouse && job.turn_id) await finalizeTurn(job.turn_id);
    }
  } catch (err) {
    await requeueClaim(job.id, err);
    console.error(`[worker] submit ${job.id}`, err);
  } finally {
    releaseClaim(job.id);
  }
}

async function handleVideo(jobId: string) {
  const job = await takeQueued(jobId);
  if (!job) return;
  try {
    const payload = (job.payload ?? {}) as {
      house?: boolean;
      clipIndex?: number;
      prompt?: string;
      referenceImageUrl?: string | null;
    };
    const isHouse = payload.house === true;
    if (!isHouse && !job.turn_id) {
      await updateJob(job.id, {
        status: "failed",
        error: "video job missing turn",
        completed_at: new Date().toISOString(),
      });
      return;
    }
    let ref = payload.referenceImageUrl ?? null;
    if (ref && !ref.startsWith("http") && !ref.startsWith("/")) {
      ref = (await signedUrl(ref, FACE_SIGNED_TTL_S)) || ref;
    }
    const submitted = await submitVideo({
      prompt: payload.prompt || "Cinematic nightclub music video, 16:9.",
      referenceImageUrl: ref?.startsWith("http") ? ref : null,
      jobId: job.id,
    });
    await updateJob(job.id, { fal_request_id: submitted.requestId });
    if (isHouse) {
      console.log(`[worker] house_clip submit ${job.id} fal=${submitted.requestId} mock=${submitted.mock}`);
    }
    if (submitted.mock) {
      await updateJob(job.id, {
        status: "complete",
        completed_at: new Date().toISOString(),
        result: { mock: true, house: isHouse, clipIndex: payload.clipIndex ?? 0 },
      });
      if (!isHouse && job.turn_id) await finalizeTurn(job.turn_id);
    }
  } catch (err) {
    await requeueClaim(job.id, err);
    console.error(`[worker] submit ${job.id}`, err);
  } finally {
    releaseClaim(job.id);
  }
}

async function handleFinalize(turnId: string) {
  await finalizeTurn(turnId);
}

async function requeueOrphanedClaims() {
  const jobs = await listStuckRunningJobs();
  const now = Date.now();
  const live = new Set(jobs.map((job) => job.id));
  for (const id of orphanFirstSeen.keys()) {
    if (!live.has(id)) orphanFirstSeen.delete(id);
  }
  for (const job of jobs) {
    if (inFlightClaims.has(job.id)) continue;
    const first = orphanFirstSeen.get(job.id) ?? now;
    orphanFirstSeen.set(job.id, first);
    if (now - first < ORPHAN_CLAIM_MS) continue;
    await updateJob(job.id, { status: "queued", error: "requeued orphan claim", fal_request_id: null });
    orphanFirstSeen.delete(job.id);
    console.log(`[worker] requeued orphan claim ${job.id} kind=${job.kind}`);
  }
}

async function reclaimQueuedJobs() {
  const jobs = houseFirst(await listQueuedJobs());
  if (!jobs.length) return;
  console.log(`[worker] reclaiming ${jobs.length} queued job(s)`);
  for (const job of jobs) {
    try {
      if (job.kind === "character") await handleCharacter(job.id);
      else if (job.kind === "music") await handleMusic(job.id);
      else if (job.kind === "video") await handleVideo(job.id);
    } catch (err) {
      console.error(`[worker] reclaim ${job.id}`, err);
    }
  }
}

async function pollRunningFalJobs() {
  const jobs = houseFirst(await listRunningFalJobs());
  if (!jobs.length) return;
  for (const job of jobs) {
    try {
      const done = await pollFalQueue(job);
      if (!done) continue;
      console.log(`[worker] fal ${job.id} ${done.status}${isHouseJob(job) ? " house_clip" : ""}`);
      await ingestFalWebhook(job.id, done.payload, done.status);
    } catch (err) {
      console.error(`[worker] fal poll ${job.id}`, err);
    }
  }
}

async function finalizeGeneratingTurns() {
  const turns = await listGeneratingTurns();
  for (const turn of turns) {
    try {
      await finalizeTurn(turn.id);
    } catch (err) {
      console.error(`[worker] finalize ${turn.id}`, err);
    }
  }
}

async function backfillHouseMedia() {
  const jobs = await listCompleteHouseJobs();
  for (const job of jobs) {
    try {
      const added = await ensureHouseMediaStored(job);
      if (!added) continue;
      console.log(`[worker] backfilled house media ${job.id}`);
      await hydratePlayingHouseTurn();
    } catch (err) {
      console.error(`[worker] house backfill ${job.id}`, err);
    }
  }
}

/** House livestream is independent of DJ music jobs. */
async function ensureHouseLivestream() {
  try {
    const spawned = await ensureHouseJobsQueued();
    if (spawned) console.log(`[worker] queued ${spawned} house_clip job(s)`);
    await backfillHouseMedia();
    await hydratePlayingHouseTurn();
  } catch (err) {
    console.error("[worker] house livestream", err);
  }
}

async function tick() {
  try {
    const n = await ensureResidents();
    if (n) console.log(`[worker] queued ${n} resident portrait(s)`);
  } catch (err) {
    console.error("[worker] ensureResidents", err);
  }
  await requeueOrphanedClaims();
  await ensureHouseLivestream();
  await reclaimQueuedJobs();
  await pollRunningFalJobs();
  await finalizeGeneratingTurns();
}

async function main() {
  const health = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "worker", mock: isMockMode() }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  health.listen(Number(process.env.HEALTH_PORT || process.env.PORT || 4100), "0.0.0.0");

  if (redisUrl()) {
    const conn = redisConnection();
    const workers = [
      new Worker(QUEUES.character, async (job) => handleCharacter(String(job.data.jobId)), { connection: conn, concurrency: 4 }),
      new Worker(QUEUES.music, async (job) => handleMusic(String(job.data.jobId)), { connection: conn, concurrency: 2 }),
      new Worker(QUEUES.video, async (job) => handleVideo(String(job.data.jobId)), { connection: conn, concurrency: 6 }),
      new Worker(QUEUES.finalize, async (job) => handleFinalize(String(job.data.turnId)), { connection: conn, concurrency: 2 }),
    ];
    for (const w of workers) {
      w.on("failed", (job, err) => console.error(`[worker] ${w.name} failed`, job?.id, err));
    }

    const sub = new Redis(redisUrl()!);
    sub.subscribe("bbr:fal:webhook");
    sub.on("message", (_ch, raw) => {
      try {
        const msg = JSON.parse(raw) as { jobId: string; payload: unknown; status: string };
        void ingestFalWebhook(msg.jobId, msg.payload, msg.status);
      } catch (err) {
        console.error("[worker] webhook ingest", err);
      }
    });
    console.log(`[worker] house livestream loop on (mock=${isMockMode()})`);
  } else {
    console.log("[worker] REDIS_URL missing — DB claim loop only (no BullMQ)");
  }

  console.log("[worker] bootstrapping residents + house_clip buffer");
  try {
    const n = await ensureResidents();
    if (n) console.log(`[worker] queued ${n} resident portrait(s)`);
  } catch (err) {
    console.error("[worker] ensureResidents", err);
  }
  await tick();
  setInterval(() => {
    void tick();
  }, RECLAIM_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
