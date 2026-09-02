import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CLIP_COUNT, HOUSE_AUDIO_PATH, HOUSE_VIDEO_PATHS, ROOM_SLUG } from "@/lib/shared/constants";
import type { Database, Json } from "@/lib/shared/database.types";
import { hasSupabaseAdmin } from "./env";
import { supabaseAdmin } from "./supabase";

type Room = Database["public"]["Tables"]["rooms"]["Row"];
type Participant = Database["public"]["Tables"]["participants"]["Row"];
type Presence = Database["public"]["Tables"]["room_presence"]["Row"];
type Chat = Database["public"]["Tables"]["chat_messages"]["Row"];
type QueueEntry = Database["public"]["Tables"]["dj_queue_entries"]["Row"];
type Turn = Database["public"]["Tables"]["turns"]["Row"];
type Job = Database["public"]["Tables"]["generation_jobs"]["Row"];
type Media = Database["public"]["Tables"]["media_assets"]["Row"];
type Mod = Database["public"]["Tables"]["moderation_events"]["Row"];

type Store = {
  rooms: Room[];
  participants: Participant[];
  presence: Presence[];
  chat: Chat[];
  queue: QueueEntry[];
  turns: Turn[];
  jobs: Job[];
  media: Media[];
  mods: Mod[];
};

const SEED_ROOM: Room = {
  id: "32b87907-1eae-466f-95a7-2fb4bf57b95f",
  slug: ROOM_SLUG,
  name: "Boom Boom Room",
  house_epoch: "2026-09-01T23:50:53.110784+00:00",
  created_at: "2026-09-01T23:50:53.110784+00:00",
};

function emptyStore(): Store {
  return {
    rooms: [SEED_ROOM],
    participants: [],
    presence: [],
    chat: [],
    queue: [],
    turns: [],
    jobs: [],
    media: [],
    mods: [],
  };
}

function storePath(): string {
  return process.env.DEV_STORE_PATH || `${process.cwd()}/.data/store.json`;
}

function readStore(): Store {
  const path = storePath();
  if (!existsSync(path)) return emptyStore();
  try {
    return { ...emptyStore(), ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: Store) {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store));
}

function nowIso() {
  return new Date().toISOString();
}

function useRemote() {
  return hasSupabaseAdmin();
}

export async function getRoomBySlug(slug = ROOM_SLUG): Promise<Room> {
  if (useRemote()) {
    const { data, error } = await supabaseAdmin().from("rooms").select("*").eq("slug", slug).single();
    if (error || !data) throw error ?? new Error("room not found");
    return data;
  }
  const store = readStore();
  const room = store.rooms.find((r) => r.slug === slug) ?? store.rooms[0];
  return room;
}

export async function getParticipantBySessionHash(hash: string): Promise<Participant | null> {
  if (useRemote()) {
    const { data } = await supabaseAdmin().from("participants").select("*").eq("session_token_hash", hash).maybeSingle();
    return data;
  }
  return readStore().participants.find((p) => p.session_token_hash === hash) ?? null;
}

export async function getParticipant(id: string): Promise<Participant | null> {
  if (useRemote()) {
    const { data } = await supabaseAdmin().from("participants").select("*").eq("id", id).maybeSingle();
    return data;
  }
  return readStore().participants.find((p) => p.id === id) ?? null;
}

export async function listParticipantsByIds(ids: string[]): Promise<Participant[]> {
  if (!ids.length) return [];
  if (useRemote()) {
    const { data } = await supabaseAdmin().from("participants").select("*").in("id", ids);
    return data ?? [];
  }
  const set = new Set(ids);
  return readStore().participants.filter((p) => set.has(p.id));
}

export async function listReadyParticipants(): Promise<Participant[]> {
  if (useRemote()) {
    const { data } = await supabaseAdmin().from("participants").select("*").eq("status", "ready");
    return data ?? [];
  }
  return readStore().participants.filter((p) => p.status === "ready");
}

export async function createParticipant(input: {
  sessionHash: string;
  displayName: string;
  characterPrompt: string;
  ipHash: string | null;
}): Promise<Participant> {
  const row: Participant = {
    id: randomUUID(),
    session_token_hash: input.sessionHash,
    display_name: input.displayName,
    character_prompt: input.characterPrompt,
    original_face_url: null,
    character_reference_url: null,
    status: "processing",
    regenerate_used: false,
    ip_hash: input.ipHash,
    muted_until: null,
    banned_until: null,
    joined_at: nowIso(),
    last_seen_at: nowIso(),
  };
  if (useRemote()) {
    const { data, error } = await supabaseAdmin().from("participants").insert(row).select("*").single();
    if (error || !data) throw error ?? new Error("insert participant failed");
    return data;
  }
  const store = readStore();
  store.participants.push(row);
  writeStore(store);
  return row;
}

export async function updateParticipant(id: string, patch: Partial<Participant>): Promise<Participant> {
  if (useRemote()) {
    const { data, error } = await supabaseAdmin().from("participants").update(patch).eq("id", id).select("*").single();
    if (error || !data) throw error ?? new Error("update participant failed");
    return data;
  }
  const store = readStore();
  const idx = store.participants.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error("participant missing");
  store.participants[idx] = { ...store.participants[idx], ...patch };
  writeStore(store);
  return store.participants[idx];
}

export async function touchParticipant(id: string) {
  await updateParticipant(id, { last_seen_at: nowIso() });
}

export async function upsertPresence(input: {
  roomId: string;
  participantId: string;
  socketId: string;
}): Promise<Presence> {
  const row: Presence = {
    id: randomUUID(),
    room_id: input.roomId,
    participant_id: input.participantId,
    socket_id: input.socketId,
    connected_at: nowIso(),
    last_heartbeat_at: nowIso(),
  };
  if (useRemote()) {
    await supabaseAdmin().from("room_presence").delete().eq("socket_id", input.socketId);
    const { data, error } = await supabaseAdmin().from("room_presence").insert(row).select("*").single();
    if (error || !data) throw error ?? new Error("presence insert failed");
    return data;
  }
  const store = readStore();
  store.presence = store.presence.filter((p) => p.socket_id !== input.socketId);
  store.presence.push(row);
  writeStore(store);
  return row;
}

export async function heartbeatPresence(socketId: string) {
  if (useRemote()) {
    await supabaseAdmin().from("room_presence").update({ last_heartbeat_at: nowIso() }).eq("socket_id", socketId);
    return;
  }
  const store = readStore();
  store.presence = store.presence.map((p) =>
    p.socket_id === socketId ? { ...p, last_heartbeat_at: nowIso() } : p,
  );
  writeStore(store);
}

export async function removePresence(socketId: string) {
  if (useRemote()) {
    await supabaseAdmin().from("room_presence").delete().eq("socket_id", socketId);
    return;
  }
  const store = readStore();
  store.presence = store.presence.filter((p) => p.socket_id !== socketId);
  writeStore(store);
}

export async function listPresence(roomId: string): Promise<Presence[]> {
  if (useRemote()) {
    const { data } = await supabaseAdmin().from("room_presence").select("*").eq("room_id", roomId);
    return data ?? [];
  }
  return readStore().presence.filter((p) => p.room_id === roomId);
}

export async function occupancy(roomId: string): Promise<number> {
  const rows = await listPresence(roomId);
  const unique = new Set(rows.map((r) => r.participant_id).filter(Boolean));
  return unique.size;
}

export async function insertChat(input: {
  roomId: string;
  participantId: string | null;
  body: string;
  kind?: Chat["kind"];
}): Promise<Chat> {
  const row: Chat = {
    id: randomUUID(),
    room_id: input.roomId,
    participant_id: input.participantId,
    body: input.body,
    kind: input.kind ?? "chat",
    created_at: nowIso(),
  };
  if (useRemote()) {
    const { data, error } = await supabaseAdmin().from("chat_messages").insert(row).select("*").single();
    if (error || !data) throw error ?? new Error("chat insert failed");
    return data;
  }
  const store = readStore();
  store.chat.push(row);
  writeStore(store);
  return row;
}

export async function listChat(roomId: string, limit = 80): Promise<Chat[]> {
  if (useRemote()) {
    const { data } = await supabaseAdmin()
      .from("chat_messages")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []).reverse();
  }
  return readStore()
    .chat.filter((c) => c.room_id === roomId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-limit);
}

export async function listQueue(roomId: string): Promise<QueueEntry[]> {
  if (useRemote()) {
    const { data } = await supabaseAdmin()
      .from("dj_queue_entries")
      .select("*")
      .eq("room_id", roomId)
      .in("status", ["waiting", "preparing", "submitted", "playing"])
      .order("created_at", { ascending: true });
    return data ?? [];
  }
  const active = new Set(["waiting", "preparing", "submitted", "playing"]);
  return readStore()
    .queue.filter((q) => q.room_id === roomId && active.has(q.status))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function getQueueEntry(id: string): Promise<QueueEntry | null> {
  if (useRemote()) {
    const { data } = await supabaseAdmin().from("dj_queue_entries").select("*").eq("id", id).maybeSingle();
    return data;
  }
  return readStore().queue.find((q) => q.id === id) ?? null;
}

export async function enqueueDj(roomId: string, participantId: string): Promise<QueueEntry> {
  const existing = (await listQueue(roomId)).find((q) => q.participant_id === participantId);
  if (existing) return existing;
  const row: QueueEntry = {
    id: randomUUID(),
    room_id: roomId,
    participant_id: participantId,
    status: "waiting",
    created_at: nowIso(),
  };
  if (useRemote()) {
    const { data, error } = await supabaseAdmin().from("dj_queue_entries").insert(row).select("*").single();
    if (error || !data) throw error ?? new Error("queue insert failed");
    return data;
  }
  const store = readStore();
  store.queue.push(row);
  writeStore(store);
  return row;
}

export async function updateQueue(id: string, status: QueueEntry["status"]): Promise<QueueEntry> {
  if (useRemote()) {
    const { data, error } = await supabaseAdmin()
      .from("dj_queue_entries")
      .update({ status })
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) throw error ?? new Error("queue update failed");
    return data;
  }
  const store = readStore();
  const idx = store.queue.findIndex((q) => q.id === id);
  if (idx < 0) throw new Error("queue missing");
  store.queue[idx] = { ...store.queue[idx], status };
  writeStore(store);
  return store.queue[idx];
}

export async function leaveQueue(roomId: string, participantId: string) {
  const rows = (await listQueue(roomId)).filter(
    (q) => q.participant_id === participantId && (q.status === "waiting" || q.status === "preparing"),
  );
  for (const row of rows) {
    await updateQueue(row.id, "skipped");
  }
}

export async function insertTurn(input: {
  roomId: string;
  kind: Turn["kind"];
  djParticipantId?: string | null;
  musicPrompt?: string | null;
  generationStatus?: Turn["generation_status"];
  audioUrl?: string | null;
  videoSegmentUrls?: Json;
  startsAt?: string | null;
  endsAt?: string | null;
}): Promise<Turn> {
  const row: Turn = {
    id: randomUUID(),
    room_id: input.roomId,
    dj_participant_id: input.djParticipantId ?? null,
    kind: input.kind,
    music_prompt: input.musicPrompt ?? null,
    starts_at: input.startsAt ?? null,
    ends_at: input.endsAt ?? null,
    audio_url: input.audioUrl ?? null,
    video_segment_urls: input.videoSegmentUrls ?? [],
    generation_status: input.generationStatus ?? "draft",
    created_at: nowIso(),
  };
  if (useRemote()) {
    const { data, error } = await supabaseAdmin().from("turns").insert(row).select("*").single();
    if (error || !data) throw error ?? new Error("turn insert failed");
    return data;
  }
  const store = readStore();
  store.turns.push(row);
  writeStore(store);
  return row;
}

export async function updateTurn(id: string, patch: Partial<Turn>): Promise<Turn> {
  if (useRemote()) {
    const { data, error } = await supabaseAdmin().from("turns").update(patch).eq("id", id).select("*").single();
    if (error || !data) throw error ?? new Error("turn update failed");
    return data;
  }
  const store = readStore();
  const idx = store.turns.findIndex((t) => t.id === id);
  if (idx < 0) throw new Error("turn missing");
  store.turns[idx] = { ...store.turns[idx], ...patch };
  writeStore(store);
  return store.turns[idx];
}

export async function getTurn(id: string): Promise<Turn | null> {
  if (useRemote()) {
    const { data } = await supabaseAdmin().from("turns").select("*").eq("id", id).maybeSingle();
    return data;
  }
  return readStore().turns.find((t) => t.id === id) ?? null;
}

export async function latestPlayingTurn(roomId: string): Promise<Turn | null> {
  if (useRemote()) {
    const { data } = await supabaseAdmin()
      .from("turns")
      .select("*")
      .eq("room_id", roomId)
      .eq("generation_status", "playing")
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  }
  return (
    readStore()
      .turns.filter((t) => t.room_id === roomId && t.generation_status === "playing")
      .sort((a, b) => (b.starts_at ?? "").localeCompare(a.starts_at ?? ""))[0] ?? null
  );
}

export async function nextReadyDjTurn(roomId: string): Promise<Turn | null> {
  if (useRemote()) {
    const { data } = await supabaseAdmin()
      .from("turns")
      .select("*")
      .eq("room_id", roomId)
      .eq("kind", "dj")
      .eq("generation_status", "ready")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    return data;
  }
  return (
    readStore()
      .turns.filter((t) => t.room_id === roomId && t.kind === "dj" && t.generation_status === "ready")
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null
  );
}

export async function insertJob(input: {
  kind: Job["kind"];
  participantId?: string | null;
  turnId?: string | null;
  payload?: Json;
  status?: Job["status"];
}): Promise<Job> {
  const row: Job = {
    id: randomUUID(),
    turn_id: input.turnId ?? null,
    participant_id: input.participantId ?? null,
    kind: input.kind,
    status: input.status ?? "queued",
    fal_request_id: null,
    payload: input.payload ?? {},
    result: null,
    error: null,
    created_at: nowIso(),
    completed_at: null,
  };
  if (useRemote()) {
    const { data, error } = await supabaseAdmin().from("generation_jobs").insert(row).select("*").single();
    if (error || !data) throw error ?? new Error("job insert failed");
    return data;
  }
  const store = readStore();
  store.jobs.push(row);
  writeStore(store);
  return row;
}

export async function updateJob(id: string, patch: Partial<Job>): Promise<Job> {
  if (useRemote()) {
    const { data, error } = await supabaseAdmin().from("generation_jobs").update(patch).eq("id", id).select("*").single();
    if (error || !data) throw error ?? new Error("job update failed");
    return data;
  }
  const store = readStore();
  const idx = store.jobs.findIndex((j) => j.id === id);
  if (idx < 0) throw new Error("job missing");
  store.jobs[idx] = { ...store.jobs[idx], ...patch };
  writeStore(store);
  return store.jobs[idx];
}

export async function getJob(id: string): Promise<Job | null> {
  if (useRemote()) {
    const { data } = await supabaseAdmin().from("generation_jobs").select("*").eq("id", id).maybeSingle();
    return data;
  }
  return readStore().jobs.find((j) => j.id === id) ?? null;
}

export async function getJobByFalId(falRequestId: string): Promise<Job | null> {
  if (useRemote()) {
    const { data } = await supabaseAdmin()
      .from("generation_jobs")
      .select("*")
      .eq("fal_request_id", falRequestId)
      .maybeSingle();
    return data;
  }
  return readStore().jobs.find((j) => j.fal_request_id === falRequestId) ?? null;
}

export async function listJobsForTurn(turnId: string): Promise<Job[]> {
  if (useRemote()) {
    const { data } = await supabaseAdmin().from("generation_jobs").select("*").eq("turn_id", turnId);
    return data ?? [];
  }
  return readStore().jobs.filter((j) => j.turn_id === turnId);
}

export async function insertMedia(input: {
  kind: Media["kind"];
  storageKey: string;
  contentType: string;
  durationMs?: number | null;
  participantId?: string | null;
  turnId?: string | null;
}): Promise<Media> {
  const row: Media = {
    id: randomUUID(),
    kind: input.kind,
    storage_key: input.storageKey,
    content_type: input.contentType,
    duration_ms: input.durationMs ?? null,
    participant_id: input.participantId ?? null,
    turn_id: input.turnId ?? null,
    visibility: "signed",
    created_at: nowIso(),
  };
  if (useRemote()) {
    const { data, error } = await supabaseAdmin().from("media_assets").insert(row).select("*").single();
    if (error || !data) throw error ?? new Error("media insert failed");
    return data;
  }
  const store = readStore();
  store.media.push(row);
  writeStore(store);
  return row;
}

export async function insertModeration(input: {
  kind: string;
  actorId?: string | null;
  targetId?: string | null;
  reason?: string | null;
  metadata?: Json;
}): Promise<Mod> {
  const row: Mod = {
    id: randomUUID(),
    kind: input.kind,
    actor_participant_id: input.actorId ?? null,
    target_participant_id: input.targetId ?? null,
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
    created_at: nowIso(),
  };
  if (useRemote()) {
    const { data, error } = await supabaseAdmin().from("moderation_events").insert(row).select("*").single();
    if (error || !data) throw error ?? new Error("mod insert failed");
    return data;
  }
  const store = readStore();
  store.mods.push(row);
  writeStore(store);
  return row;
}

export function houseTurnTemplate(roomId: string): Omit<Turn, "id" | "created_at"> {
  return {
    room_id: roomId,
    dj_participant_id: null,
    kind: "house",
    music_prompt: "House buffer — midnight basement disco",
    starts_at: null,
    ends_at: null,
    audio_url: HOUSE_AUDIO_PATH,
    video_segment_urls: [...HOUSE_VIDEO_PATHS],
    generation_status: "ready",
  };
}

export { CLIP_COUNT };
