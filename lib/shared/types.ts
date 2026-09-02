export type ParticipantStatus = "processing" | "ready" | "blocked";
export type QueueStatus = "waiting" | "preparing" | "submitted" | "playing" | "done" | "skipped";
export type GenerationStatus = "draft" | "generating" | "ready" | "playing" | "complete" | "failed";
export type TurnKind = "house" | "dj";
export type ChatKind = "chat" | "system";
export type JobKind = "character" | "music" | "video";
export type JobStatus = "queued" | "running" | "complete" | "failed";
export type MediaKind = "face" | "character" | "audio" | "video" | "house_audio" | "house_video";

export type PublicParticipant = {
  id: string;
  displayName: string;
  characterPrompt: string;
  characterUrl: string | null;
  status: ParticipantStatus;
  muted: boolean;
  isDj: boolean;
  isResident: boolean;
};

export type QueueEntryView = {
  id: string;
  participantId: string;
  displayName: string;
  characterUrl: string | null;
  status: QueueStatus;
  createdAt: string;
  position: number;
};

export type ChatMessageView = {
  id: string;
  participantId: string | null;
  displayName: string;
  body: string;
  kind: ChatKind;
  createdAt: string;
};

export type VideoSegment = {
  url: string;
  participantId: string | null;
  displayName: string | null;
};

export type TurnView = {
  id: string;
  kind: TurnKind;
  generationStatus: GenerationStatus;
  musicPrompt: string | null;
  audioUrl: string | null;
  videoSegments: VideoSegment[];
  startsAt: string | null;
  endsAt: string | null;
  dj: PublicParticipant | null;
};

export type ClockSnapshot = {
  serverNow: number;
  audioOffsetMs: number;
  clipIndex: number;
  clipOffsetMs: number;
  crossfading: boolean;
  nextClipIndex: number;
};

export type RoomState = {
  roomId: string;
  slug: string;
  name: string;
  mockMode: boolean;
  occupancy: number;
  maxOccupancy: number;
  participants: PublicParticipant[];
  queue: QueueEntryView[];
  chat: ChatMessageView[];
  currentTurn: TurnView | null;
  upcomingTurn: TurnView | null;
  compose: {
    entryId: string;
    participantId: string;
    deadlineAt: string;
  } | null;
  clock: ClockSnapshot;
};

export type SessionView = {
  participantId: string;
  displayName: string;
  status: ParticipantStatus;
  characterUrl: string | null;
  regenerateUsed: boolean;
  muted: boolean;
  banned: boolean;
};

export type CharacterJobPayload = {
  participantId: string;
  faceStorageKey: string;
  characterPrompt: string;
};

export type MusicJobPayload = {
  turnId: string;
  prompt: string;
  lyrics?: string;
};

export type VideoJobPayload = {
  turnId: string;
  clipIndex: number;
  prompt: string;
  referenceImageUrl: string | null;
  participantId: string | null;
};

export type RoomEvent =
  | { type: "state"; state: RoomState }
  | { type: "chat"; message: ChatMessageView }
  | { type: "clock"; clock: ClockSnapshot; turnId: string | null }
  | { type: "system"; body: string };
