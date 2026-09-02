import type { ChatMessageView } from "./types";

export const OPTIMISTIC_MATCH_WINDOW_MS = 15_000;

export type OptimisticChat = ChatMessageView & {
  tempId: string;
  status: "pending" | "failed";
};

export function matchesOptimistic(server: ChatMessageView, opt: OptimisticChat): boolean {
  if (server.kind !== "chat" || opt.kind !== "chat") return false;
  if (server.body !== opt.body) return false;
  if (opt.participantId && server.participantId !== opt.participantId) return false;
  const serverAt = new Date(server.createdAt).getTime();
  const optAt = new Date(opt.createdAt).getTime();
  if (!Number.isFinite(serverAt) || !Number.isFinite(optAt)) return false;
  return Math.abs(serverAt - optAt) <= OPTIMISTIC_MATCH_WINDOW_MS;
}

/** Drop optimistic rows once the matching server line exists (one-to-one). */
export function reconcileOptimisticChat(
  server: ChatMessageView[],
  optimistic: OptimisticChat[],
): OptimisticChat[] {
  const used = new Set<string>();
  return optimistic.filter((opt) => {
    const match = server.find((row) => !used.has(row.id) && matchesOptimistic(row, opt));
    if (!match) return true;
    used.add(match.id);
    return false;
  });
}

export type DisplayChat = ChatMessageView & {
  pending?: boolean;
  failed?: boolean;
};

export function mergeChat(
  server: ChatMessageView[],
  optimistic: OptimisticChat[],
): DisplayChat[] {
  const leftover = reconcileOptimisticChat(server, optimistic);
  return [
    ...server,
    ...leftover.map((row) => ({
      ...row,
      id: row.tempId,
      pending: row.status === "pending",
      failed: row.status === "failed",
    })),
  ];
}

export function chatSendErrorCopy(error?: string): string {
  if (error === "slow down") return "Slow down a second.";
  if (error === "muted") return "You're muted.";
  if (error === "banned") return "You're out.";
  return "Message didn't send.";
}
