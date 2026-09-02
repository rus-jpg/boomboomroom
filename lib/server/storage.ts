import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { supabaseAdmin } from "./supabase";
import { hasSupabaseAdmin } from "./env";

export type Bucket = "faces" | "media";

export async function uploadBytes(
  bucket: Bucket,
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  if (!hasSupabaseAdmin()) {
    const rel = `generated/${bucket}/${key}`;
    const dest = join(process.cwd(), "public", rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, body);
    return `/${rel}`;
  }
  const { error } = await supabaseAdmin().storage.from(bucket).upload(key, body, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  return `${bucket}/${key}`;
}

export async function signedUrl(storageKey: string, expiresIn = 3600): Promise<string | null> {
  if (!storageKey) return null;
  if (storageKey.startsWith("/") || storageKey.startsWith("http")) return storageKey;
  if (storageKey.startsWith("local://")) {
    return `/${storageKey.replace("local://", "generated/")}`;
  }
  if (!hasSupabaseAdmin()) return storageKey.startsWith("generated/") ? `/${storageKey}` : null;
  const [bucket, ...rest] = storageKey.includes("/") ? storageKey.split("/") : ["media", storageKey];
  const key = rest.join("/");
  const { data, error } = await supabaseAdmin().storage.from(bucket).createSignedUrl(key, expiresIn);
  if (error) return null;
  return data.signedUrl;
}

export async function downloadUrlToBuffer(url: string): Promise<{ buf: Buffer; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, contentType };
}
