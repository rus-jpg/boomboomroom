export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      chat_messages: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["chat_kind"];
          participant_id: string | null;
          room_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["chat_kind"];
          participant_id?: string | null;
          room_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["chat_messages"]["Insert"]>;
        Relationships: [];
      };
      dj_queue_entries: {
        Row: {
          created_at: string;
          id: string;
          participant_id: string;
          preparing_at: string | null;
          room_id: string;
          status: Database["public"]["Enums"]["queue_status"];
        };
        Insert: {
          created_at?: string;
          id?: string;
          participant_id: string;
          preparing_at?: string | null;
          room_id: string;
          status?: Database["public"]["Enums"]["queue_status"];
        };
        Update: Partial<Database["public"]["Tables"]["dj_queue_entries"]["Insert"]>;
        Relationships: [];
      };
      generation_jobs: {
        Row: {
          completed_at: string | null;
          created_at: string;
          error: string | null;
          fal_request_id: string | null;
          id: string;
          kind: Database["public"]["Enums"]["job_kind"];
          participant_id: string | null;
          payload: Json | null;
          result: Json | null;
          status: Database["public"]["Enums"]["job_status"];
          turn_id: string | null;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          error?: string | null;
          fal_request_id?: string | null;
          id?: string;
          kind: Database["public"]["Enums"]["job_kind"];
          participant_id?: string | null;
          payload?: Json | null;
          result?: Json | null;
          status?: Database["public"]["Enums"]["job_status"];
          turn_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["generation_jobs"]["Insert"]>;
        Relationships: [];
      };
      media_assets: {
        Row: {
          content_type: string;
          created_at: string;
          duration_ms: number | null;
          id: string;
          kind: Database["public"]["Enums"]["media_kind"];
          participant_id: string | null;
          storage_key: string;
          turn_id: string | null;
          visibility: string;
        };
        Insert: {
          content_type: string;
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          kind: Database["public"]["Enums"]["media_kind"];
          participant_id?: string | null;
          storage_key: string;
          turn_id?: string | null;
          visibility?: string;
        };
        Update: Partial<Database["public"]["Tables"]["media_assets"]["Insert"]>;
        Relationships: [];
      };
      moderation_events: {
        Row: {
          actor_participant_id: string | null;
          created_at: string;
          id: string;
          kind: string;
          metadata: Json | null;
          reason: string | null;
          target_participant_id: string | null;
        };
        Insert: {
          actor_participant_id?: string | null;
          created_at?: string;
          id?: string;
          kind: string;
          metadata?: Json | null;
          reason?: string | null;
          target_participant_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["moderation_events"]["Insert"]>;
        Relationships: [];
      };
      participants: {
        Row: {
          banned_until: string | null;
          character_prompt: string;
          character_reference_url: string | null;
          display_name: string;
          id: string;
          ip_hash: string | null;
          joined_at: string;
          last_seen_at: string;
          muted_until: string | null;
          original_face_url: string | null;
          regenerate_used: boolean;
          session_token_hash: string;
          status: Database["public"]["Enums"]["participant_status"];
          is_resident: boolean;
        };
        Insert: {
          banned_until?: string | null;
          character_prompt: string;
          character_reference_url?: string | null;
          display_name: string;
          id?: string;
          ip_hash?: string | null;
          joined_at?: string;
          last_seen_at?: string;
          muted_until?: string | null;
          original_face_url?: string | null;
          regenerate_used?: boolean;
          session_token_hash: string;
          status?: Database["public"]["Enums"]["participant_status"];
          is_resident?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["participants"]["Insert"]>;
        Relationships: [];
      };
      room_presence: {
        Row: {
          connected_at: string;
          id: string;
          last_heartbeat_at: string;
          participant_id: string | null;
          room_id: string;
          socket_id: string;
        };
        Insert: {
          connected_at?: string;
          id?: string;
          last_heartbeat_at?: string;
          participant_id?: string | null;
          room_id: string;
          socket_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["room_presence"]["Insert"]>;
        Relationships: [];
      };
      rooms: {
        Row: {
          created_at: string;
          house_epoch: string;
          id: string;
          name: string;
          slug: string;
        };
        Insert: {
          created_at?: string;
          house_epoch: string;
          id?: string;
          name: string;
          slug: string;
        };
        Update: Partial<Database["public"]["Tables"]["rooms"]["Insert"]>;
        Relationships: [];
      };
      turns: {
        Row: {
          audio_url: string | null;
          created_at: string;
          dj_participant_id: string | null;
          ends_at: string | null;
          generation_status: Database["public"]["Enums"]["generation_status"];
          id: string;
          kind: Database["public"]["Enums"]["turn_kind"];
          music_prompt: string | null;
          room_id: string;
          starts_at: string | null;
          video_segment_urls: Json | null;
        };
        Insert: {
          audio_url?: string | null;
          created_at?: string;
          dj_participant_id?: string | null;
          ends_at?: string | null;
          generation_status?: Database["public"]["Enums"]["generation_status"];
          id?: string;
          kind: Database["public"]["Enums"]["turn_kind"];
          music_prompt?: string | null;
          room_id: string;
          starts_at?: string | null;
          video_segment_urls?: Json | null;
        };
        Update: Partial<Database["public"]["Tables"]["turns"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      chat_kind: "chat" | "system";
      generation_status: "draft" | "generating" | "ready" | "playing" | "complete" | "failed";
      job_kind: "character" | "music" | "video";
      job_status: "queued" | "running" | "complete" | "failed";
      media_kind: "face" | "character" | "audio" | "video" | "house_audio" | "house_video";
      participant_status: "processing" | "ready" | "blocked";
      queue_status: "waiting" | "preparing" | "submitted" | "playing" | "done" | "skipped";
      turn_kind: "house" | "dj";
    };
    CompositeTypes: Record<string, never>;
  };
};
