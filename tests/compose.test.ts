import { describe, expect, it } from "vitest";
import { COMPOSE_WINDOW_MS } from "../lib/shared/constants";
import { composeDeadlineMs, composeStartedAtMs, isComposeWindowExpired } from "../lib/shared/compose";

describe("compose window", () => {
  const joined = "2026-09-02T00:00:00.000Z";
  const promoted = "2026-09-02T00:05:00.000Z";

  it("starts the 60s clock at preparing_at, not queue join time", () => {
    const entry = { created_at: joined, preparing_at: promoted };
    expect(composeStartedAtMs(entry)).toBe(Date.parse(promoted));
    expect(composeDeadlineMs(entry)).toBe(Date.parse(promoted) + COMPOSE_WINDOW_MS);
    expect(isComposeWindowExpired(entry, Date.parse("2026-09-02T00:05:30.000Z"))).toBe(false);
    expect(isComposeWindowExpired(entry, Date.parse("2026-09-02T00:06:00.000Z"))).toBe(true);
  });

  it("falls back to created_at when preparing_at is missing so legacy stuck rows expire", () => {
    const entry = { created_at: joined, preparing_at: null };
    expect(isComposeWindowExpired(entry, Date.parse("2026-09-02T00:06:00.000Z"))).toBe(true);
  });

  it("treats invalid timestamps as already expired", () => {
    expect(isComposeWindowExpired({ created_at: "not-a-date", preparing_at: null }, Date.now())).toBe(true);
  });
});
