import { DEFAULT_CHARACTER_MODEL } from "@/lib/shared/constants";

export function isMockMode(): boolean {
  return !process.env.FAL_KEY;
}

export function hasSupabaseAdmin(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function characterModel(): string {
  return process.env.CHARACTER_MODEL_ENDPOINT || DEFAULT_CHARACTER_MODEL;
}

export function appUrl(): string {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function webhookBaseUrl(): string {
  return (process.env.WEBHOOK_BASE_URL || appUrl()).replace(/\/$/, "");
}

export function redisUrl(): string | undefined {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  if (process.env.REDIS_PRIVATE_URL) return process.env.REDIS_PRIVATE_URL;
  const host = process.env.REDISHOST;
  if (!host) return undefined;
  const port = process.env.REDISPORT || "6379";
  const user = process.env.REDISUSER || "default";
  const pass = process.env.REDISPASSWORD || "";
  const auth = pass ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : "";
  return `redis://${auth}${host}:${port}`;
}

export function realtimePort(): number {
  const raw = process.env.REALTIME_PORT || process.env.PORT || "4000";
  return Number(raw);
}

export function sessionSecret(): string {
  return process.env.SESSION_SECRET || "dev-only-session-secret-change-me";
}

export function moderatorSecret(): string | undefined {
  return process.env.MODERATOR_SECRET;
}

export function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
  return url;
}

export function supabaseAnonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
}

export function supabaseServiceKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for persistence");
  return key;
}
