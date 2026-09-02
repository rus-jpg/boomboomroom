const ADVANCE_SLACK_MS = 50;

/** Whether the playback engine should complete the current turn and start the next one. */
export function shouldAdvancePlayback(opts: {
  playingKind: string;
  endsAt: string | null | undefined;
  hasReadyDj: boolean;
  now?: number;
}): boolean {
  const now = opts.now ?? Date.now();
  const ends = opts.endsAt ? new Date(opts.endsAt).getTime() : 0;
  if (ends <= now + ADVANCE_SLACK_MS) return true;
  // House yields immediately to a ready human DJ. A live human set is never cut for another DJ.
  return opts.playingKind === "house" && opts.hasReadyDj;
}
