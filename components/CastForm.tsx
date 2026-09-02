"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CHARACTER_MAX, CHARACTER_MIN, NAME_MAX, NAME_MIN, PRODUCT_NAME } from "@/lib/shared/constants";

export function CastForm({ onCast }: { onCast?: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [face, setFace] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function takeFile(file: File | undefined) {
    if (!file) return;
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setFace(file);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    if (form.get("consent") === "on") form.set("consent", "true");
    if (face) form.set("face", face);
    const res = await fetch("/api/cast", { method: "POST", body: form });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "Couldn't enter.");
      return;
    }
    if (onCast) onCast();
    else {
      router.push("/room");
      router.refresh();
    }
  }

  return (
    <form className="cast-form" onSubmit={onSubmit}>
      <div className="cast-head">
        <p className="cast-brand display">{PRODUCT_NAME}</p>
        <h1 className="display" id="cast-title">
          Entrance
        </h1>
        <p className="cast-pitch">A live AI music party — cast in, dance, take the booth.</p>
      </div>
      <label className="cast-face-label">
        Face
        <div className={`cast-drop${preview ? " is-filled" : ""}${drag ? " is-drag" : ""}`}>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" />
          ) : (
            <span>Drop or click</span>
          )}
          <input
            className="cast-drop-input"
            name="face"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required={!face}
            onChange={(e) => takeFile(e.target.files?.[0])}
            onDragEnter={() => setDrag(true)}
            onDragOver={() => setDrag(true)}
            onDragLeave={() => setDrag(false)}
            onDrop={() => setDrag(false)}
          />
        </div>
      </label>
      <label className="cast-name-label">
        Name
        <input
          name="displayName"
          type="text"
          required
          minLength={NAME_MIN}
          maxLength={NAME_MAX}
          placeholder="Midnight Fox"
          autoComplete="nickname"
        />
      </label>
      <label className="cast-look-label">
        Look
        <textarea
          name="characterPrompt"
          required
          minLength={CHARACTER_MIN}
          maxLength={CHARACTER_MAX}
          placeholder="Wet vinyl, gold teeth, chrome visor"
        />
      </label>
      <label className="consent">
        <input name="consent" type="checkbox" required />
        <span>I consent. Face stays private — generated look only.</span>
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button className="cta" type="submit" disabled={busy}>
        {busy ? "Entering…" : "Enter"}
      </button>
    </form>
  );
}
