import type { Json } from "@/lib/shared/database.types";

export const RECLAIM_MS = 12_000;
/** MiniMax music can take several minutes; fail zombies after this. */
export const STALE_RUNNING_MS = 9 * 60 * 1000;
/** Cap house video/music submits so a tick cannot spend 30–60s on livestream backfill. */
export const HOUSE_RECLAIM_PER_TICK = 3;
/** Copy at most this many complete house results into media per tick. */
export const HOUSE_BACKFILL_PER_TICK = 3;
export const HOUSE_BACKFILL_SCAN = 12;

type JobLike = {
  kind: string;
  turn_id?: string | null;
  created_at: string;
  payload: unknown;
};

export type StaleAction = { action: "keep" } | { action: "fail"; error: string } | { action: "resubmit" };

function isHousePayload(job: { payload: unknown }): boolean {
  return (job.payload as { house?: boolean } | null)?.house === true;
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return { ...(payload as Record<string, unknown>) };
  }
  return {};
}

export function jobSubmittedAtMs(job: JobLike): number {
  const submittedAt = asRecord(job.payload).submittedAt;
  if (typeof submittedAt === "string") {
    const ms = Date.parse(submittedAt);
    if (Number.isFinite(ms)) return ms;
  }
  return Date.parse(job.created_at);
}

export function payloadWithSubmittedAt(payload: unknown, at = new Date()): Json {
  return { ...asRecord(payload), submittedAt: at.toISOString() } as Json;
}

export function payloadForMusicResubmit(payload: unknown): Json {
  const next = asRecord(payload);
  delete next.submittedAt;
  return { ...next, resubmitted: true } as Json;
}

/** DJ turn jobs first, then character/other, house livestream last. */
export function djFirst<T extends { kind: string; payload: unknown; turn_id?: string | null }>(jobs: T[]): T[] {
  const dj: T[] = [];
  const house: T[] = [];
  const rest: T[] = [];
  for (const job of jobs) {
    if (isHousePayload(job)) house.push(job);
    else if (job.turn_id) dj.push(job);
    else rest.push(job);
  }
  return [...dj, ...rest, ...house];
}

/** Process every non-house job, then at most `maxHouse` house jobs. */
export function capHouseJobs<T extends { kind: string; payload: unknown; turn_id?: string | null }>(
  jobs: T[],
  maxHouse = HOUSE_RECLAIM_PER_TICK,
): T[] {
  const out: T[] = [];
  let house = 0;
  for (const job of jobs) {
    if (isHousePayload(job)) {
      if (house >= maxHouse) continue;
      house += 1;
    }
    out.push(job);
  }
  return out;
}

export function resolveStaleRunningJob(job: JobLike, now = Date.now(), timeoutMs = STALE_RUNNING_MS): StaleAction {
  if (now - jobSubmittedAtMs(job) < timeoutMs) return { action: "keep" };
  const payload = asRecord(job.payload);
  const isDjMusic = job.kind === "music" && Boolean(job.turn_id) && payload.house !== true;
  if (isDjMusic && payload.resubmitted !== true) return { action: "resubmit" };
  return { action: "fail", error: `timed out after ${Math.round(timeoutMs / 60000)}m in running` };
}

/**
 * In-process mutex. Overlapping setInterval ticks skip rather than pile up.
 * Does not use Redis — Railway worker Postgres claim path stays authoritative.
 */
export function createTickGate(): (fn: () => Promise<void>) => Promise<boolean> {
  let running = false;
  return async (fn) => {
    if (running) return false;
    running = true;
    try {
      await fn();
      return true;
    } finally {
      running = false;
    }
  };
}
