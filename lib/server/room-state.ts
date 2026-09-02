import { CLIP_COUNT, COMPOSE_WINDOW_MS, HOUSE_AUDIO_PATH, MAX_PARTICIPANTS, MIN_PARTY_SIZE } from "@/lib/shared/constants";
import { clockFromStart } from "@/lib/shared/clock";
import { composeDeadlineMs } from "@/lib/shared/compose";
import { isPlayableVideoUrl } from "@/lib/shared/media";
import { isMuted } from "@/lib/shared/moderation";
import type { ChatMessageView, PublicParticipant, QueueEntryView, RoomState, TurnView, VideoSegment } from "@/lib/shared/types";
import { isMockMode } from "./env";
import {
  getParticipant,
  getRoomBySlug,
  latestPlayingTurn,
  listChat,
  listParticipantsByIds,
  listPresence,
  listQueue,
  listResidents,
  listJobsForTurn,
  nextReadyDjTurn,
} from "./repo";
import { signedUrl } from "./storage";

async function resolveUrl(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (value.startsWith("/") || value.startsWith("http")) return value;
  return (await signedUrl(value)) || value;
}

async function toPublic(p: {
  id: string;
  display_name: string;
  character_prompt: string;
  character_reference_url: string | null;
  status: PublicParticipant["status"];
  muted_until: string | null;
  is_resident?: boolean;
}, isDj: boolean): Promise<PublicParticipant> {
  return {
    id: p.id,
    displayName: p.display_name,
    characterPrompt: p.character_prompt,
    characterUrl: await resolveUrl(p.character_reference_url),
    status: p.status,
    muted: isMuted(p.muted_until),
    isDj,
    isResident: Boolean(p.is_resident),
  };
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

function emptySegments(): VideoSegment[] {
  return Array.from({ length: CLIP_COUNT }, () => ({
    url: "",
    participantId: null,
    displayName: null,
  }));
}

async function toTurnView(turn: Awaited<ReturnType<typeof latestPlayingTurn>>): Promise<TurnView | null> {
  if (!turn) return null;
  const dj = turn.dj_participant_id ? await getParticipant(turn.dj_participant_id) : null;
  const rawVideos = asStringArray(turn.video_segment_urls).filter((url) => isPlayableVideoUrl(url));
  const featuredByIndex = new Map<number, { participantId: string | null; displayName: string | null }>();
  if (turn.kind === "dj") {
    const jobs = await listJobsForTurn(turn.id);
    const videos = jobs
      .filter((job) => job.kind === "video")
      .sort((a, b) => {
        const ai = Number((a.payload as { clipIndex?: number } | null)?.clipIndex ?? 0);
        const bi = Number((b.payload as { clipIndex?: number } | null)?.clipIndex ?? 0);
        return ai - bi;
      });
    const ids = [...new Set(videos.map((job) => job.participant_id).filter((id): id is string => Boolean(id)))];
    const people = await listParticipantsByIds(ids);
    const byId = new Map(people.map((p) => [p.id, p]));
    for (const [i, job] of videos.entries()) {
      const person = job.participant_id ? byId.get(job.participant_id) : null;
      featuredByIndex.set(i, {
        participantId: person?.id ?? job.participant_id ?? null,
        displayName: person?.display_name ?? null,
      });
    }
  }
  const segments: VideoSegment[] = [];
  if (rawVideos.length === 0) {
    segments.push(...emptySegments());
  } else {
    for (let i = 0; i < CLIP_COUNT; i++) {
      const resolved = await resolveUrl(rawVideos[i % rawVideos.length]);
      const meta = featuredByIndex.get(i);
      segments.push({
        url: resolved ?? "",
        participantId: meta?.participantId ?? null,
        displayName: meta?.displayName ?? null,
      });
    }
  }
  return {
    id: turn.id,
    kind: turn.kind,
    generationStatus: turn.generation_status,
    musicPrompt: turn.music_prompt,
    audioUrl: (await resolveUrl(turn.audio_url)) ?? HOUSE_AUDIO_PATH,
    videoSegments: segments,
    startsAt: turn.starts_at,
    endsAt: turn.ends_at,
    dj: dj ? await toPublic(dj, true) : null,
  };
}

export async function buildRoomState(slug?: string): Promise<RoomState> {
  const room = await getRoomBySlug(slug);
  const [presence, queue, chat, playing, upcoming] = await Promise.all([
    listPresence(room.id),
    listQueue(room.id),
    listChat(room.id),
    latestPlayingTurn(room.id),
    nextReadyDjTurn(room.id),
  ]);
  const participantIds = [
    ...presence.map((p) => p.participant_id),
    ...queue.map((q) => q.participant_id),
    ...chat.map((c) => c.participant_id),
    playing?.dj_participant_id,
  ].filter((id): id is string => Boolean(id));
  const people = await listParticipantsByIds([...new Set(participantIds)]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const djId = playing?.dj_participant_id ?? queue.find((q) => q.status === "preparing" || q.status === "playing")?.participant_id ?? null;

  const uniquePresence = new Map<string, (typeof people)[number]>();
  for (const row of presence) {
    if (!row.participant_id) continue;
    const p = byId.get(row.participant_id);
    if (p) uniquePresence.set(p.id, p);
  }

  const participants: PublicParticipant[] = [];
  for (const p of uniquePresence.values()) {
    if (p.is_resident) continue;
    participants.push(await toPublic(p, p.id === djId));
  }

  if (uniquePresence.size < MIN_PARTY_SIZE) {
    const residents = await listResidents();
    for (const r of residents) {
      if (uniquePresence.has(r.id)) continue;
      participants.push(await toPublic(r, false));
    }
  }

  const queueView: QueueEntryView[] = [];
  let position = 1;
  for (const q of queue) {
    const p = byId.get(q.participant_id);
    queueView.push({
      id: q.id,
      participantId: q.participant_id,
      displayName: p?.display_name ?? "Guest",
      characterUrl: p ? await resolveUrl(p.character_reference_url) : null,
      status: q.status,
      createdAt: q.created_at,
      position: position++,
    });
  }

  const chatView: ChatMessageView[] = chat.map((c) => ({
    id: c.id,
    participantId: c.participant_id,
    displayName: c.kind === "system" ? "Room" : (byId.get(c.participant_id ?? "")?.display_name ?? "Guest"),
    body: c.body,
    kind: c.kind,
    createdAt: c.created_at,
  }));

  const currentTurn = (await toTurnView(playing)) ?? {
    id: "house-live",
    kind: "house" as const,
    generationStatus: "playing" as const,
    musicPrompt: "House buffer — midnight basement disco",
    audioUrl: HOUSE_AUDIO_PATH,
    videoSegments: emptySegments(),
    startsAt: new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString(),
    endsAt: new Date(Math.floor(Date.now() / 60_000) * 60_000 + 60_000).toISOString(),
    dj: null,
  };

  const startMs = currentTurn.startsAt ? new Date(currentTurn.startsAt).getTime() : Date.now();
  const composing = queue.find((q) => q.status === "preparing");

  return {
    roomId: room.id,
    slug: room.slug,
    name: room.name,
    mockMode: isMockMode(),
    occupancy: uniquePresence.size,
    maxOccupancy: MAX_PARTICIPANTS,
    participants,
    queue: queueView,
    chat: chatView,
    currentTurn,
    upcomingTurn: await toTurnView(upcoming),
    compose: composing
      ? {
          entryId: composing.id,
          participantId: composing.participant_id,
          deadlineAt: new Date(composeDeadlineMs(composing, COMPOSE_WINDOW_MS)).toISOString(),
        }
      : null,
    clock: clockFromStart(startMs, Date.now()),
  };
}
