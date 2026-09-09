import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Effect, Exit, Scope } from "effect";
import Corestore from "corestore";
import { openRoomLog, type RoomLog } from "./RoomLog";
import type { Ticket } from "./ticket";

// A real Corestore in a temp dir: the point is to exercise Autobase's apply
// with our ops, not to mock it away.

const dirs: string[] = [];
const stores: Array<{ close: () => Promise<void> }> = [];

const withLog = async <A>(body: (log: RoomLog, reopen: () => Promise<RoomLog>) => Promise<A>): Promise<A> => {
  const dir = mkdtempSync(join(tmpdir(), "collagen-log-"));
  dirs.push(dir);
  const store = new Corestore(dir);
  await store.ready();
  stores.push(store);
  let scope = await Effect.runPromise(Scope.make());
  const open = (key: string | null) =>
    Effect.runPromise(openRoomLog(store, "room", key).pipe(Effect.provideService(Scope.Scope, scope)));
  const log = await open(null);
  // "restart": close the running log, then open the same key again
  const reopen = async () => {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    scope = await Effect.runPromise(Scope.make());
    return open(log.key);
  };
  try {
    return await body(log, reopen);
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
};

const ticket = (over: Partial<Ticket>): Ticket => ({
  id: "t1",
  project: "sandbox",
  goal: "fix average()",
  createdBy: "alice",
  updatedAt: 1,
  steps: [{ id: "s1", owner: "bob", intent: "investigate", description: "look", needs: [], status: "pending", updatedAt: 1 }],
  ...over,
});

afterEach(async () => {
  for (const s of stores.splice(0)) await s.close().catch(() => {});
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("RoomLog", () => {
  it("a fresh log is ours to write; the creator's key is the log key", async () => {
    await withLog(async (log) => {
      expect(log.writable()).toBe(true);
      expect(log.key).toMatch(/^[0-9a-f]{64}$/);
      expect(log.writerKey).toBe(log.key);
    });
  });

  it("ticket entries merge in the view: a settled step beats a later pending copy", async () => {
    await withLog(async (log) => {
      await Effect.runPromise(log.append({ op: "ticket", ticket: ticket({}) }));
      const settled = ticket({
        updatedAt: 2,
        steps: [{ id: "s1", owner: "bob", intent: "investigate", description: "look", needs: [], status: "settled", result: "found it", updatedAt: 2 }],
      });
      await Effect.runPromise(log.append({ op: "ticket", ticket: settled }));
      // a stale pending copy arriving afterwards must not undo the settlement
      await Effect.runPromise(log.append({ op: "ticket", ticket: ticket({ updatedAt: 3 }) }));
      const view = await Effect.runPromise(log.read);
      expect(view.tickets).toHaveLength(1);
      expect(view.tickets[0]!.steps[0]!.status).toBe("settled");
      expect(view.tickets[0]!.steps[0]!.result).toBe("found it");
    });
  });

  it("rename is last-writer-wins by ts, and messages keep log order with a running position", async () => {
    await withLog(async (log) => {
      await Effect.runPromise(log.append({ op: "rename", name: "newer", ts: 20 }));
      await Effect.runPromise(log.append({ op: "rename", name: "older", ts: 10 }));
      const msg = (id: string) => ({
        id,
        threadId: "th",
        from: "alice",
        fromName: "alice",
        to: "bob",
        project: "sandbox",
        intent: "ping",
        findings: id,
        ts: 1,
      });
      await Effect.runPromise(log.append({ op: "msg", msg: msg("m1") }));
      await Effect.runPromise(log.append({ op: "msg", msg: msg("m2") }));
      const view = await Effect.runPromise(log.read);
      expect(view.name).toEqual({ name: "newer", ts: 20 });
      expect(view.messages.map((m) => [m.seq, m.msg.id])).toEqual([
        [0, "m1"],
        [1, "m2"],
      ]);
    });
  });

  it("attachments are references keyed by ticket and id; a repeat does not overwrite", async () => {
    await withLog(async (log) => {
      const a = {
        id: "a1",
        ticketId: "t1",
        holder: "k-bob",
        holderName: "bob",
        name: "bob-0123456789abcdef.codex.jsonl",
        bytes: 100,
        mime: "application/jsonl",
        transcript: { from: "bob", ai: "codex", threadId: "0123456789abcdef", sessionId: "s", entries: 2, since: 5, origin: "thread-0123456789abcdef" },
        attachedAt: 10,
      };
      await Effect.runPromise(log.append({ op: "attachment", attachment: a }));
      await Effect.runPromise(log.append({ op: "attachment", attachment: { ...a, bytes: 999 } }));
      await Effect.runPromise(log.append({ op: "attachment", attachment: { ...a, id: "a2", ticketId: "t2", name: "shot.png", mime: "image/png", transcript: undefined } }));
      const view = await Effect.runPromise(log.read);
      expect(view.attachments.map((x) => [x.ticketId, x.id, x.bytes])).toEqual([
        ["t1", "a1", 100],
        ["t2", "a2", 100],
      ]);
    });
  });

  it("malformed entries are skipped, not fatal", async () => {
    await withLog(async (log) => {
      await Effect.runPromise(log.append({ op: "bogus", anything: 1 } as never));
      await Effect.runPromise(log.append({ op: "member", key: "k", name: "carol", ts: 1 }));
      const view = await Effect.runPromise(log.read);
      expect(view.members.map((m) => m.name)).toEqual(["carol"]);
    });
  });

  it("reopening by key in the same store finds the same view and stays writable", async () => {
    await withLog(async (log, reopen) => {
      await Effect.runPromise(log.append({ op: "ticket", ticket: ticket({}) }));
      const again = await reopen();
      expect(again.key).toBe(log.key);
      expect(again.writable()).toBe(true);
      expect((await Effect.runPromise(again.read)).tickets).toHaveLength(1);
    });
  });
});
