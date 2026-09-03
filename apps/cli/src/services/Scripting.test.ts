import { describe, expect, it } from "vitest";
import { Effect, Layer, Option, PubSub, Stream, SubscriptionRef } from "effect";
import { Room, deriveThreadId, type Peer, type RoomMessage, type Ticket } from "@collagen/p2p";
import { PeerNotConnected } from "@collagen/p2p";
import { Inbox } from "./Inbox";
import { Scripting } from "./Scripting";

const peers: Peer[] = [
  { key: "k-bob", name: "bob", ai: "claude-code", projects: [{ name: "sandbox", path: "/x" }] },
  { key: "k-carol", name: "carol", ai: "codex", projects: [{ name: "sandbox", path: "/y" }] },
  { key: "k-dave", name: "dave", ai: null, projects: [] },
];

const roomStub = (sent: Array<{ peerKey: string; intent: string; findings: string }>) =>
  Layer.effect(
    Room,
    Effect.gen(function* () {
      const roster = yield* SubscriptionRef.make<ReadonlyArray<Peer>>(peers);
      const inbound = yield* PubSub.unbounded<RoomMessage>();
      const sendTo = (
        peerKey: string,
        payload: { project: string; intent: string; findings: string },
      ) =>
        peerKey === "k-dave"
          ? Effect.fail(new PeerNotConnected({ peerKey }))
          : Effect.sync(() => {
              sent.push({ peerKey, intent: payload.intent, findings: payload.findings });
              const msg: RoomMessage = {
                id: `m-${sent.length}`,
                threadId: deriveThreadId("me", peerKey, payload.project),
                from: "me",
                fromName: "tester",
                project: payload.project,
                intent: payload.intent,
                findings: payload.findings,
                ts: 1,
              };
              return msg;
            });
      const tickets = yield* SubscriptionRef.make<ReadonlyMap<string, Ticket>>(new Map());
      const meta = yield* SubscriptionRef.make({ name: "test room", ts: 0 });
      return {
        roster,
        meta,
        rename: (_name: string) => Effect.void,
        tickets,
        shareTicket: (ticket: Ticket) => Effect.succeed(ticket),
        messages: Stream.fromPubSub(inbound),
        sendTo,
        updateProfile: Effect.void,
      };
    }),
  );

const make = () => {
  const sent: Array<{ peerKey: string; intent: string; findings: string }> = [];
  const layer = Scripting.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(roomStub(sent), Inbox.layer)),
  );
  return { sent, layer };
};

const run = <A>(layer: Layer.Layer<Scripting | Inbox>, body: Effect.Effect<A, unknown, unknown>) =>
  Effect.runPromise(body.pipe(Effect.provide(layer as Layer.Layer<never>)) as Effect.Effect<A>);

describe("Scripting", () => {
  it("describe renders the language card with mounted collagen tools", async () => {
    const { layer } = make();
    const card = await run(
      layer,
      Effect.gen(function* () {
        const s = yield* Scripting;
        return s.describe();
      }),
    );
    expect(card).toContain("collagen.listRoom");
    expect(card).toContain("collagen.sendToPeer");
    expect(card).toContain("collagen.getMessages");
  });

  it("executes a fan-out plan: list room, message every sandbox peer, bounded", async () => {
    const { layer, sent } = make();
    const result = await run(
      layer,
      Effect.gen(function* () {
        const s = yield* Scripting;
        return yield* Effect.promise(() =>
          s.execute(`
            const room = await collagen.listRoom();
            const targets = room.peers.filter(p => p.projects.indexOf("sandbox") !== -1);
            const outcomes = await Promise.all(
              targets.slice(0, 5).map(p => collagen.sendToPeer({
                peer: p.name,
                project: "sandbox",
                intent: "ask-review",
                findings: "please look at average()",
              })));
            return { asked: outcomes.length };
          `),
        );
      }),
    );
    expect(result.status).toBe("ok");
    expect((result as { output: { asked: number } }).output).toEqual({ asked: 2 });
    expect(sent.map((s) => s.peerKey).sort()).toEqual(["k-bob", "k-carol"]);
  });

  it("rejects unbounded loops at validation, before anything runs", async () => {
    const { layer, sent } = make();
    const result = await run(
      layer,
      Effect.gen(function* () {
        const s = yield* Scripting;
        return yield* Effect.promise(() =>
          s.execute(`
            while (true) { await collagen.listRoom(); }
          `),
        );
      }),
    );
    expect(result.status).toBe("invalid");
    expect(sent).toHaveLength(0);
  });

  it("surfaces peer errors as data, not exceptions", async () => {
    const { layer } = make();
    const result = await run(
      layer,
      Effect.gen(function* () {
        const s = yield* Scripting;
        return yield* Effect.promise(() =>
          s.execute(`
            const r = await collagen.sendToPeer({ peer: "dave", project: "sandbox", intent: "ping", findings: "hi" });
            return r;
          `),
        );
      }),
    );
    expect(result.status).toBe("ok");
    expect((result as { output: { delivered: boolean } }).output.delivered).toBe(false);
  });
});
