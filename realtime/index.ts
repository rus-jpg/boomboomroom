import { createServer } from "node:http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { HEARTBEAT_MS, MAX_PARTICIPANTS, SESSION_COOKIE } from "@/lib/shared/constants";
import { decodeSessionCookie, sha256 } from "@/lib/server/crypto";
import { appUrl, realtimePort, redisUrl } from "@/lib/server/env";
import {
  getParticipant,
  getParticipantBySessionHash,
  getRoomBySlug,
  heartbeatPresence,
  occupancy,
  removePresence,
  touchParticipant,
  upsertPresence,
} from "@/lib/server/repo";
import { verifyTicket } from "@/lib/server/ticket";
import { isBanned } from "@/lib/shared/moderation";
import { RoomEngine } from "./engine";

type HandshakeAuth = {
  token?: string;
  ticket?: string;
};

function cookieToken(header: string | undefined): string | null {
  if (!header) return null;
  const parts = header.split(";").map((p) => p.trim());
  const raw = parts.find((p) => p.startsWith(`${SESSION_COOKIE}=`));
  if (!raw) return null;
  return decodeSessionCookie(decodeURIComponent(raw.slice(SESSION_COOKIE.length + 1)));
}

async function main() {
  const engine = new RoomEngine();
  const http = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "realtime", mock: !process.env.FAL_KEY }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const origins = [appUrl(), "http://localhost:3000", "http://127.0.0.1:3000"].filter(Boolean);
  const io = new Server(http, {
    cors: { origin: origins, credentials: true },
    transports: ["websocket", "polling"],
  });

  const url = redisUrl();
  if (url) {
    const pub = new Redis(url);
    const sub = new Redis(url);
    io.adapter(createAdapter(pub, sub));
    sub.subscribe("bbr:room:events");
    sub.on("message", (_ch, message) => {
      void (async () => {
        try {
          const parsed = JSON.parse(message) as { type?: string };
          // Finalize-to-ready publishes turn-ready so house can yield on this tick, not ends_at.
          if (parsed?.type === "turn-ready") await engine.advancePlayback();
          if (parsed?.type === "webhook") io.to("room:main").emit("room:poke", parsed);
        } catch {
          /* ignore */
        }
        await engine.emit();
      })();
    });
  }

  engine.on((state) => {
    io.to("room:main").emit("room:state", state);
  });

  io.use(async (socket, next) => {
    try {
      const auth = socket.handshake.auth as HandshakeAuth;
      let person = null;
      if (auth.ticket) {
        const id = verifyTicket(auth.ticket);
        person = id ? await getParticipant(id) : null;
      }
      if (!person) {
        const token = auth.token || cookieToken(socket.handshake.headers.cookie);
        if (!token) return next(new Error("cast required"));
        person = await getParticipantBySessionHash(sha256(token));
      }
      if (!person) return next(new Error("unknown session"));
      if (isBanned(person.banned_until)) return next(new Error("banned"));
      socket.data.participantId = person.id;
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  io.on("connection", async (socket) => {
    const participantId = socket.data.participantId as string;
    const room = await getRoomBySlug();
    const cap = await occupancy(room.id);
    if (cap >= MAX_PARTICIPANTS) {
      socket.emit("room:error", { message: "Room is at capacity (20)." });
      socket.disconnect(true);
      return;
    }
    await upsertPresence({ roomId: room.id, participantId, socketId: socket.id });
    await touchParticipant(participantId);
    await socket.join("room:main");
    socket.emit("room:state", await engine.snapshot());

    const beat = setInterval(() => {
      void heartbeatPresence(socket.id);
    }, HEARTBEAT_MS);

    socket.on("chat:send", async (body: string, ack?: (r: { ok: boolean; error?: string }) => void) => {
      try {
        await engine.chat(participantId, String(body ?? ""));
        await engine.emit();
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : "chat failed" });
      }
    });

    socket.on("queue:join", async (ack?: (r: { ok: boolean; error?: string }) => void) => {
      try {
        await engine.joinQueue(participantId);
        await engine.emit();
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : "queue failed" });
      }
    });

    socket.on("queue:leave", async (ack?: (r: { ok: boolean; error?: string }) => void) => {
      try {
        await engine.leaveQueue(participantId);
        await engine.emit();
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : "leave failed" });
      }
    });

    socket.on("room:leave", async (ack?: (r: { ok: boolean; error?: string }) => void) => {
      try {
        await engine.leaveRoom(participantId);
        await engine.emit();
        ack?.({ ok: true });
        socket.disconnect(true);
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : "leave failed" });
      }
    });

    socket.on(
      "booth:submit",
      async (payload: { prompt?: string; lyrics?: string }, ack?: (r: { ok: boolean; error?: string }) => void) => {
        try {
          await engine.submitPrompt(participantId, String(payload?.prompt ?? ""), payload?.lyrics);
          await engine.emit();
          ack?.({ ok: true });
        } catch (err) {
          ack?.({ ok: false, error: err instanceof Error ? err.message : "submit failed" });
        }
      },
    );

    socket.on("room:sync", async () => {
      socket.emit("room:state", await engine.snapshot());
    });

    socket.on("disconnect", async () => {
      clearInterval(beat);
      await removePresence(socket.id);
      await engine.emit();
    });
  });

  await engine.start();
  const port = realtimePort();
  http.listen(port, "0.0.0.0", () => {
    console.log(`[realtime] Boom Boom Room listening on :${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
