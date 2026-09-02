"use client";

import { ENTRANCE_LOOP_PATH } from "@/lib/shared/constants";

export function GateBackdrop() {
  return (
    <div className="gate-backdrop" aria-hidden>
      <video src={ENTRANCE_LOOP_PATH} autoPlay muted loop playsInline preload="auto" />
      <div className="gate-backdrop-dim" />
    </div>
  );
}
