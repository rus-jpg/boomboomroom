import { describe, expect, it } from "vitest";
import {
  chatSendErrorCopy,
  mergeChat,
  matchesOptimistic,
  reconcileOptimisticChat,
  type OptimisticChat,
} from "../lib/shared/optimistic-chat";
import type { ChatMessageView } from "../lib/shared/types";

function row(partial: Partial<ChatMessageView> & Pick<ChatMessageView, "id" | "body">): ChatMessageView {
  return {
    participantId: "p-1",
    displayName: "Midnight Fox",
    kind: "chat",
    createdAt: new Date("2026-09-02T16:00:00.000Z").toISOString(),
    ...partial,
  };
}

function opt(partial: Partial<OptimisticChat> & Pick<OptimisticChat, "tempId" | "body">): OptimisticChat {
  return {
    id: partial.tempId,
    participantId: "p-1",
    displayName: "Midnight Fox",
    kind: "chat",
    createdAt: new Date("2026-09-02T16:00:00.000Z").toISOString(),
    status: "pending",
    ...partial,
  };
}

describe("optimistic chat reconcile", () => {
  it("keeps a pending line until a matching server message arrives", () => {
    const pending = opt({ tempId: "opt-1", body: "this bass is illegal" });
    expect(mergeChat([], [pending])).toHaveLength(1);
    const server = row({ id: "srv-1", body: "this bass is illegal" });
    expect(reconcileOptimisticChat([server], [pending])).toEqual([]);
    expect(mergeChat([server], [pending]).map((m) => m.id)).toEqual(["srv-1"]);
  });

  it("does not double-consume identical back-to-back sends", () => {
    const a = opt({ tempId: "opt-a", body: "hi", createdAt: "2026-09-02T16:00:00.000Z" });
    const b = opt({ tempId: "opt-b", body: "hi", createdAt: "2026-09-02T16:00:01.000Z" });
    const first = row({ id: "srv-1", body: "hi", createdAt: "2026-09-02T16:00:00.200Z" });
    const leftover = reconcileOptimisticChat([first], [a, b]);
    expect(leftover.map((m) => m.tempId)).toEqual(["opt-b"]);
  });

  it("does not match a different speaker or body", () => {
    const pending = opt({ tempId: "opt-1", body: "hello" });
    expect(matchesOptimistic(row({ id: "x", body: "hello", participantId: "p-2" }), pending)).toBe(false);
    expect(matchesOptimistic(row({ id: "x", body: "other" }), pending)).toBe(false);
    expect(matchesOptimistic(row({ id: "x", body: "hello", kind: "system", participantId: null }), pending)).toBe(
      false,
    );
  });

  it("maps send failures to light copy", () => {
    expect(chatSendErrorCopy("slow down")).toBe("Slow down a second.");
    expect(chatSendErrorCopy("blocked")).toBe("Message didn't send.");
  });
});
