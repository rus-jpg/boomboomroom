"use client";

import { io, type Socket } from "socket.io-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HOUSE_AUDIO_PATH, HOUSE_VIDEO_PATHS, PRODUCT_NAME } from "@/lib/shared/constants";
import { clockFromStart } from "@/lib/shared/clock";
import type { RoomState, SessionView } from "@/lib/shared/types";
import { Stage } from "./Stage";

function demoState(name: string): RoomState {
  const start = Math.floor(Date.now() / 60_000) * 60_000;
  return {
    roomId: "demo",
    slug: "main",
    name: PRODUCT_NAME,
    mockMode: true,
    occupancy: 1,
    maxOccupancy: 20,
    participants: [
      {
        id: "me",
        displayName: name,
        characterPrompt: "demo",
        characterUrl: null,
        status: "ready",
        muted: false,
        isDj: false,
      },
    ],
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
      videoSegments: HOUSE_VIDEO_PATHS.map((url) => ({ url, participantId: null, displayName: null })),
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
  session: SessionView;
  realtimeUrl: string;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [socketReady, setSocketReady] = useState(false);
  const [chat, setChat] = useState("");
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
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
  }, [realtimeUrl, session.displayName]);

  const clock = useMemo(() => {
    const start = state.currentTurn?.startsAt ? new Date(state.currentTurn.startsAt).getTime() : now;
    return clockFromStart(start, now);
  }, [state.currentTurn, now]);

  const myCompose = state.compose?.participantId === session.participantId;
  const composeLeft = state.compose
    ? Math.max(0, Math.ceil((new Date(state.compose.deadlineAt).getTime() - now) / 1000))
    : 0;
  const inQueue = state.queue.some((q) => q.participantId === session.participantId);

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
    <div className="room-shell">
      <header style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", alignItems: "center" }}>
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
          {inQueue ? (
            <button className="secondary" type="button" onClick={() => emit("queue:leave")}>
              Step off
            </button>
          ) : (
            <button type="button" onClick={() => emit("queue:join")} disabled={session.status !== "ready"}>
              Get on the decks
            </button>
          )}
        </section>
        <section className="panel">
          <h2>In the room</h2>
          {state.participants.map((p) => (
            <div className="person" key={p.id}>
              {p.characterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="avatar" src={p.characterUrl} alt="" />
              ) : (
                <div className="avatar" />
              )}
              <div>
                <strong>{p.displayName}</strong>
                {p.isDj ? " · booth" : ""}
                {p.muted ? " · muted" : ""}
              </div>
            </div>
          ))}
          <p className="lede" style={{ marginTop: 12, fontSize: 13 }}>
            Six clips a turn. Appearances rotate through whoever is ready. Audio is the master clock.
          </p>
        </section>
        <section className="panel">
          <h2>Open chat</h2>
          <div className="chat-log">
            {state.chat.map((m) => (
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

      {session.status === "processing" ? (
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
              onClick={() => emit("booth:submit", { prompt, lyrics: lyrics || undefined })}
            >
              Generate the set
            </button>
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
  );
}
