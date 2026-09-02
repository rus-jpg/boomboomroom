"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CastForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    if (form.get("consent") === "on") form.set("consent", "true");
    const res = await fetch("/api/cast", { method: "POST", body: form });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(json.error || "Casting failed.");
      return;
    }
    router.push("/room");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <p className="eyebrow">Anonymous cast</p>
      <h1 className="display" style={{ fontSize: 48, margin: "8px 0 18px" }}>
        Become someone
      </h1>
      <label>
        Display name
        <input name="displayName" required minLength={2} maxLength={24} placeholder="Midnight Fox" />
      </label>
      <label>
        Character description
        <textarea
          name="characterPrompt"
          required
          minLength={12}
          maxLength={400}
          placeholder="Chrome-skinned dancer in a wet vinyl coat, gold teeth, 1978 Tokyo basement"
        />
      </label>
      <label>
        Face photo
        <input name="face" type="file" accept="image/jpeg,image/png,image/webp" required />
      </label>
      <label className="consent">
        <input name="consent" type="checkbox" required />
        <span>
          I consent to this photo being used to generate a stylized character and short music-video clips
          that may include my likeness in this room. Faces stay private; only the generated look is shown.
        </span>
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button className="cta" type="submit" disabled={busy}>
        {busy ? "Casting…" : "Enter Boom Boom Room"}
      </button>
    </form>
  );
}
