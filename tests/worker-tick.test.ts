import { describe, expect, it } from "vitest";
import {
  capHouseJobs,
  createTickGate,
  djFirst,
  HOUSE_RECLAIM_PER_TICK,
  jobSubmittedAtMs,
  payloadForMusicResubmit,
  payloadWithSubmittedAt,
  resolveStaleRunningJob,
  STALE_RUNNING_MS,
} from "../worker/tick";

function job(partial: {
  kind?: string;
  turn_id?: string | null;
  created_at?: string;
  payload?: unknown;
}) {
  return {
    kind: partial.kind ?? "video",
    turn_id: partial.turn_id ?? null,
    created_at: partial.created_at ?? "2026-09-02T00:00:00.000Z",
    payload: partial.payload ?? {},
  };
}

describe("djFirst", () => {
  it("polls DJ turn jobs before house livestream and character work", () => {
    const house = job({ payload: { house: true } });
    const character = job({ kind: "character" });
    const music = job({ kind: "music", turn_id: "turn-1", payload: { prompt: "disco" } });
    expect(djFirst([house, character, music])).toEqual([music, character, house]);
  });
});

describe("capHouseJobs", () => {
  it("never drops DJ work and keeps at most N house jobs", () => {
    const dj = job({ kind: "music", turn_id: "t1" });
    const house = Array.from({ length: 12 }, (_, i) => job({ payload: { house: true, i } }));
    const capped = capHouseJobs([house[0], dj, ...house.slice(1)], 3);
    expect(capped.filter((j) => (j.payload as { house?: boolean }).house).length).toBe(3);
    expect(capped).toContain(dj);
    expect(HOUSE_RECLAIM_PER_TICK).toBe(3);
  });
});

describe("stale running jobs", () => {
  const now = Date.parse("2026-09-02T00:10:00.000Z");

  it("keeps jobs younger than the timeout", () => {
    expect(
      resolveStaleRunningJob(job({ created_at: "2026-09-02T00:05:00.000Z" }), now, STALE_RUNNING_MS).action,
    ).toBe("keep");
  });

  it("uses submittedAt when present so queue wait is not counted", () => {
    const staleCreated = job({
      kind: "music",
      turn_id: "t1",
      created_at: "2026-09-02T00:00:00.000Z",
      payload: { submittedAt: "2026-09-02T00:09:00.000Z" },
    });
    expect(jobSubmittedAtMs(staleCreated)).toBe(Date.parse("2026-09-02T00:09:00.000Z"));
    expect(resolveStaleRunningJob(staleCreated, now).action).toBe("keep");
  });

  it("resubmits DJ music once, then fails", () => {
    const stuck = job({
      kind: "music",
      turn_id: "t1",
      created_at: "2026-09-02T00:00:00.000Z",
      payload: { prompt: "disco" },
    });
    expect(resolveStaleRunningJob(stuck, now).action).toBe("resubmit");
    const again = job({
      ...stuck,
      payload: payloadForMusicResubmit(stuck.payload),
    });
    expect(resolveStaleRunningJob(again, now)).toEqual({
      action: "fail",
      error: "timed out after 9m in running",
    });
  });

  it("fails stale house video instead of resubmitting", () => {
    expect(
      resolveStaleRunningJob(
        job({ payload: { house: true }, created_at: "2026-09-02T00:00:00.000Z" }),
        now,
      ).action,
    ).toBe("fail");
  });

  it("stamps and clears submittedAt around a music resubmit", () => {
    const stamped = payloadWithSubmittedAt({ prompt: "disco" }, new Date("2026-09-02T00:01:00.000Z"));
    expect(stamped).toMatchObject({ prompt: "disco", submittedAt: "2026-09-02T00:01:00.000Z" });
    expect(payloadForMusicResubmit(stamped)).toEqual({ prompt: "disco", resubmitted: true });
  });
});

describe("createTickGate", () => {
  it("skips overlapping ticks and unlocks after the first finishes", async () => {
    const run = createTickGate();
    let release!: () => void;
    const first = run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    expect(await run(async () => undefined)).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(await run(async () => undefined)).toBe(true);
  });

  it("unlocks when the tick throws", async () => {
    const run = createTickGate();
    await expect(
      run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await run(async () => undefined)).toBe(true);
  });
});
