"use client";

import { io, type Socket } from "socket.io-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HOUSE_AUDIO_PATH, PRODUCT_NAME } from "@/lib/shared/constants";
import { clockFromStart } from "@/lib/shared/clock";
import type { RoomState, SessionView } from "@/lib/shared/types";
import { CastForm } from "./CastForm";
import { Stage } from "./Stage";

function demoPortrait(hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 120">
    <defs>
      <linearGradient id="g${hue}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${hue},72%,28%)"/>
        <stop offset="1" stop-color="hsl(${(hue + 48) % 360},80%,12%)"/>
      </linearGradient>
    </defs>
    <rect width="90" height="120" fill="url(#g${hue})"/>
    <circle cx="45" cy="46" r="20" fill="rgba(246,239,230,0.28)"/>
    <ellipse cx="45" cy="108" rx="32" ry="28" fill="rgba(246,239,230,0.16)"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function demoState(name: string): RoomState {
  const start = Math.floor(Date.now() / 60_000) * 60_000;
  const crew = [
    { id: "me", displayName: name, hue: 332, isDj: false, isResident: false, muted: false },
    { id: "res-1", displayName: "House Cat", hue: 188, isDj: false, isResident: true, muted: false },
    { id: "dj-1", displayName: "Velvet", hue: 38, isDj: true, isResident: false, muted: false },
    { id: "p-3", displayName: "Neon Fox", hue: 312, isDj: false, isResident: false, muted: false },
    { id: "p-4", displayName: "Basement", hue: 262, isDj: false, isResident: false, muted: true },
    { id: "p-5", displayName: "Acid Mira", hue: 148, isDj: false, isResident: false, muted: false },
    { id: "p-6", displayName: "Chrome", hue: 200, isDj: false, isResident: false, muted: false },
    { id: "p-7", displayName: "Lowlight", hue: 18, isDj: false, isResident: false, muted: false },
  ] as const;
  return {
    roomId: "demo",
    slug: "main",
    name: PRODUCT_NAME,
    mockMode: true,
    occupancy: crew.length,
    maxOccupancy: 20,
    participants: crew.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      characterPrompt: "demo",
      characterUrl: demoPortrait(p.hue),
      status: "ready" as const,
      muted: p.muted,
      isDj: p.isDj,
      isResident: p.isResident,
    })),
    queue: [],
    chat: [
      {
        id: "sys",
        participantId: null,
        displayName: "Room",
        body: "Demo booth is live. House is holding the floor.",
        kind: "system",
        createdAt: new Date().toISOString(),
      },
    ],
    currentTurn: {
      id: "house-demo",
      kind: "house",
      generationStatus: "playing",
      musicPrompt: "House buffer",
      audioUrl: HOUSE_AUDIO_PATH,
      videoSegments: Array.from({ length: 6 }, () => ({ url: "", participantId: null, displayName: null })),
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 60_000).toISOString(),
      dj: null,
    },
    upcomingTurn: null,
    compose: null,
    clock: clockFromStart(start, Date.now()),
  };
}

export function RoomClient({
  initial,
  session,
  realtimeUrl,
}: {
  initial: RoomState;
  session: SessionView | null;
  realtimeUrl: string;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [socketReady, setSocketReady] = useState(false);
  const [chat, setChat] = useState("");
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(initial.clock.serverNow);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!session) {
      if (!realtimeUrl) setState(demoState("Guest"));
      return;
    }
    if (!realtimeUrl) {
      setState(demoState(session.displayName));
      return;
    }
    let cancelled = false;
    let socket: Socket | null = null;
    void (async () => {
      const ticketRes = await fetch("/api/ticket").then((r) => r.json()).catch(() => ({}));
      if (cancelled) return;
      socket = io(realtimeUrl, {
        withCredentials: true,
        transports: ["websocket", "polling"],
        auth: { ticket: ticketRes.ticket },
      });
      socketRef.current = socket;
      socket.on("connect", () => setSocketReady(true));
      socket.on("connect_error", () => {
        setNotice("Realtime offline — house demo is holding.");
        setState((s) => ({ ...s, mockMode: true }));
      });
      socket.on("room:state", (next: RoomState) => setState(next));
      socket.on("room:error", (err: { message?: string }) => setNotice(err.message ?? "Room error"));
    })();
    return () => {
      cancelled = true;
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [realtimeUrl, session]);

  const clock = useMemo(() => {
    const start = state.currentTurn?.startsAt ? new Date(state.currentTurn.startsAt).getTime() : now;
    return clockFromStart(start, now);
  }, [state.currentTurn, now]);

  const myStatus = session
    ? (state.participants.find((p) => p.id === session.participantId)?.status ?? session.status)
    : null;
  const myCompose = Boolean(session && state.compose?.participantId === session.participantId);
  const composeLeft = state.compose
    ? Math.max(0, Math.ceil((new Date(state.compose.deadlineAt).getTime() - now) / 1000))
    : 0;
  const inQueue = Boolean(session && state.queue.some((q) => q.participantId === session.participantId));
  const guest = !session;

  function emit(event: string, payload?: unknown) {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      setNotice("Queue and chat need the realtime server.");
      return;
    }
    socket.emit(event, payload, (res?: { ok?: boolean; error?: string }) => {
      if (res && res.ok === false) setNotice(res.error ?? "failed");
    });
  }

  return (
    <>
      <div className="room-shell" inert={guest || undefined}>
      <header className="room-header">
        <strong className="display">{PRODUCT_NAME}</strong>
        <span className="pill">
          {state.occupancy}/{state.maxOccupancy}
          {state.mockMode ? " · mock gen" : ""}
          {!socketReady ? " · house clock" : ""}
        </span>
      </header>
      <Stage turn={state.currentTurn} clock={clock} />
      <div className="room-body">
        <section className="panel">
          <h2>Booth queue</h2>
          <div className="panel-scroll">
            {state.queue.length === 0 ? <p className="lede">Empty. House is spinning.</p> : null}
            {state.queue.map((q) => (
              <div className="queue-item" key={q.id}>
                <span>{String(q.position).padStart(2, "0")}</span>
                <div>
                  <strong>{q.displayName}</strong>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>{q.status}</div>
                </div>
              </div>
            ))}
          </div>
          {inQueue ? (
            <button className="secondary" type="button" onClick={() => emit("queue:leave")}>
              Step off
            </button>
          ) : (
            <button type="button" onClick={() => emit("queue:join")} disabled={myStatus !== "ready"}>
              Get on the decks
            </button>
          )}
        </section>
        <section className="panel">
          <h2>In the room</h2>
          <div className="panel-scroll">
            <div className="people-grid">
              {state.participants.map((p) => {
                const cues = [
                  p.isResident ? "Resident" : null,
                  p.isDj ? "booth" : null,
                  p.muted ? "muted" : null,
                ].filter(Boolean);
                return (
                  <article
                    className={`person-tile${p.isDj ? " is-dj" : ""}${p.muted ? " is-muted" : ""}`}
                    key={p.id}
                    title={cues.length ? `${p.displayName} · ${cues.join(" · ")}` : p.displayName}
                  >
                    <div className="person-portrait">
                      {p.characterUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="avatar" src={p.characterUrl} alt="" />
                      ) : (
                        <div className="avatar" aria-hidden />
                      )}
                    </div>
                    <strong className="person-name">{p.displayName}</strong>
                    {p.isResident ? <span className="person-resident">Resident</span> : null}
                    {p.isDj || p.muted ? (
                      <span className="person-meta">
                        {p.isDj ? "booth" : null}
                        {p.isDj && p.muted ? " · " : null}
                        {p.muted ? "muted" : null}
                      </span>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>
        </section>
        <section className="panel">
          <h2>Open chat</h2>
          <div className="chat-log">
            {state.chat.slice(-40).map((m) => (
              <div className="chat-line" key={m.id}>
                <strong>{m.displayName}</strong>
                <span>{m.body}</span>
              </div>
            ))}
          </div>
          <form
            className="chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              const body = chat.trim();
              if (!body) return;
              setChat("");
              void emit("chat:send", body);
            }}
          >
            <input value={chat} onChange={(e) => setChat(e.target.value)} maxLength={240} placeholder="Say something" />
            <button type="submit">Send</button>
          </form>
        </section>
      </div>

      {myStatus === "processing" ? (
        <div className="processing">
          <div>
            <p className="eyebrow">Casting</p>
            <h2 className="display">Summoning your look</h2>
            <p>The booth is open. Your character drops when generation finishes.</p>
          </div>
        </div>
      ) : null}

      {myCompose ? (
        <div className="booth">
          <div className="booth-card">
            <p className="eyebrow">Your 60 seconds</p>
            <h2 className="display">{composeLeft}s to lock a prompt</h2>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Genre: acid disco. BPM: 122. Wet basement, vocoder lead, four-on-the-floor…"
            />
            <textarea
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              placeholder="Optional lyrics. Leave blank for instrumental."
            />
            <button
              type="button"
              onClick={() => {
                if (prompt.trim().length < 8) {
                  setNotice("Prompt too short — need at least 8 characters.");
                  return;
                }
                emit("booth:submit", { prompt, lyrics: lyrics || undefined });
              }}
            >
              Generate the set
            </button>
            {notice ? <p className="lede" style={{ color: "var(--amber)", marginTop: 10 }}>{notice}</p> : null}
          </div>
        </div>
      ) : null}

      {session?.banned ? (
        <div className="processing">
          <div>
            <h2 className="display">You're out</h2>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p style={{ textAlign: "center", color: "var(--amber)", paddingBottom: 16 }}>
          {notice}{" "}
          <button className="cta ghost" type="button" onClick={() => router.refresh()}>
            Refresh
          </button>
        </p>
      ) : null}
      </div>
      {guest ? (
        <div className="cast-modal" role="dialog" aria-modal="true" aria-labelledby="cast-title">
          <CastForm onCast={() => router.refresh()} />
        </div>
      ) : null}
    </>
  );
}
