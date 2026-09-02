import { Worker } from "bullmq";
import { createServer } from "node:http";
import Redis from "ioredis";
import { QUEUES } from "@/lib/shared/constants";
import { isMockMode, redisUrl } from "@/lib/server/env";
import { ensureHouseJobsQueued, hydratePlayingHouseTurn, isHouseJob } from "@/lib/server/house";
import { pollFalQueue, submitCharacter, submitMusic, submitResidentPortrait, submitVideo } from "@/lib/server/fal";
import { ensureResidents } from "@/lib/server/residents";
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
  listRunningJobs,
  updateJob,
  updateParticipant,
} from "@/lib/server/repo";
import { redisConnection } from "@/lib/server/redis";
import { signedUrl, uploadBytes } from "@/lib/server/storage";
import { ensureHouseMediaStored, finalizeTurn, ingestFalWebhook } from "./ingest";
import { mockCharacterJpeg } from "./mock";
import {
  capHouseJobs,
  createTickGate,
  djFirst,
  HOUSE_BACKFILL_PER_TICK,
  HOUSE_BACKFILL_SCAN,
  HOUSE_RECLAIM_PER_TICK,
  payloadForMusicResubmit,
  payloadWithSubmittedAt,
  RECLAIM_MS,
  resolveStaleRunningJob,
} from "./tick";

const FACE_SIGNED_TTL_S = 60 * 60 * 24;
const runTick = createTickGate();

async function takeQueued(jobId: string) {
  const current = await getJob(jobId);
  if (!current) return null;
  if (current.status === "complete" || current.status === "failed" || current.fal_request_id) return null;
  if (current.status !== "queued") return null;
  return claimQueuedJob(jobId);
}

async function handleCharacter(jobId: string) {
  const job = await takeQueued(jobId);
  if (!job || !job.participant_id) return;
  const person = await getParticipant(job.participant_id);
  if (!person) return;

  const payload = (job.payload ?? {}) as { resident?: boolean };
  const isResident = person.is_resident || payload.resident === true;
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
  await updateJob(job.id, {
    fal_request_id: submitted.requestId,
    payload: payloadWithSubmittedAt(job.payload),
  });

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
}

async function handleMusic(jobId: string) {
  const job = await takeQueued(jobId);
  if (!job) return;
  const payload = (job.payload ?? {}) as { prompt?: string; lyrics?: string; house?: boolean };
  const isHouse = payload.house === true;
  if (!isHouse && !job.turn_id) return;
  const submitted = await submitMusic({
    prompt: payload.prompt || "Genre: midnight disco. BPM: 118.",
    lyrics: payload.lyrics,
    jobId: job.id,
  });
  await updateJob(job.id, {
    fal_request_id: submitted.requestId,
    payload: payloadWithSubmittedAt(job.payload),
  });
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
}

async function handleVideo(jobId: string) {
  const job = await takeQueued(jobId);
  if (!job) return;
  const payload = (job.payload ?? {}) as {
    house?: boolean;
    clipIndex?: number;
    prompt?: string;
    referenceImageUrl?: string | null;
  };
  const isHouse = payload.house === true;
  if (!isHouse && !job.turn_id) return;

  let ref = payload.referenceImageUrl ?? null;
  if (ref && !ref.startsWith("http") && !ref.startsWith("/")) {
    ref = (await signedUrl(ref, FACE_SIGNED_TTL_S)) || ref;
  }
  const submitted = await submitVideo({
    prompt: payload.prompt || "Cinematic nightclub music video, 16:9.",
    referenceImageUrl: ref?.startsWith("http") ? ref : null,
    jobId: job.id,
  });
  await updateJob(job.id, {
    fal_request_id: submitted.requestId,
    payload: payloadWithSubmittedAt(job.payload),
  });
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
}

async function handleFinalize(turnId: string) {
  await finalizeTurn(turnId);
}

async function expireStaleRunningJobs() {
  const jobs = await listRunningJobs();
  for (const job of jobs) {
    const decision = resolveStaleRunningJob(job);
    if (decision.action === "keep") continue;
    try {
      if (decision.action === "resubmit") {
        await updateJob(job.id, {
          status: "queued",
          fal_request_id: null,
          error: "fal request stalled; resubmitting",
          payload: payloadForMusicResubmit(job.payload),
        });
        console.log(`[worker] resubmit stale DJ music ${job.id}`);
        continue;
      }
      await updateJob(job.id, {
        status: "failed",
        error: decision.error,
        completed_at: new Date().toISOString(),
      });
      console.log(`[worker] expire stale ${job.kind}${isHouseJob(job) ? " house" : ""} ${job.id}`);
      if (job.turn_id) await finalizeTurn(job.turn_id);
    } catch (err) {
      console.error(`[worker] expire ${job.id}`, err);
    }
  }
}

async function reclaimQueuedJobs() {
  const jobs = capHouseJobs(djFirst(await listQueuedJobs()), HOUSE_RECLAIM_PER_TICK);
  if (!jobs.length) return;
  const house = jobs.filter((job) => isHouseJob(job)).length;
  console.log(`[worker] reclaiming ${jobs.length} queued job(s) (${house} house)`);
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
  const jobs = djFirst(await listRunningFalJobs());
  if (!jobs.length) return;
  for (const job of jobs) {
    try {
      const done = await pollFalQueue(job);
      if (!done) continue;
      console.log(`[worker] fal ${job.id} ${done.status}${isHouseJob(job) ? " house" : ""}`);
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
  const jobs = await listCompleteHouseJobs(HOUSE_BACKFILL_SCAN);
  let stored = 0;
  for (const job of jobs) {
    if (stored >= HOUSE_BACKFILL_PER_TICK) break;
    try {
      const added = await ensureHouseMediaStored(job);
      if (!added) continue;
      stored += 1;
      console.log(`[worker] backfilled house media ${job.id}`);
      await hydratePlayingHouseTurn();
    } catch (err) {
      console.error(`[worker] house backfill ${job.id}`, err);
    }
  }
}

/** House livestream is independent of DJ music jobs; keep it cheap so ticks stay short. */
async function ensureHouseLivestream() {
  try {
    const spawned = await ensureHouseJobsQueued();
    if (spawned) console.log(`[worker] queued ${spawned} house job(s)`);
    await backfillHouseMedia();
    await hydratePlayingHouseTurn();
  } catch (err) {
    console.error("[worker] house livestream", err);
  }
}

async function tickBody() {
  await expireStaleRunningJobs();
  await pollRunningFalJobs();
  await reclaimQueuedJobs();
  await finalizeGeneratingTurns();
  await ensureHouseLivestream();
}

async function tick() {
  try {
    const ran = await runTick(tickBody);
    if (!ran) console.log("[worker] skip tick — previous still running");
  } catch (err) {
    console.error("[worker] tick failed", err);
  }
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
