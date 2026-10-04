import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Layer, SubscriptionRef } from "effect";
import { NotWritable, type DraftComment, type LocalState, type ReviewComment, type ReviewContext, type Ticket } from "@collagen/p2p";
import { IdentityService } from "./Identity";
import { Rooms, type RoomHandle } from "./Rooms";
import { StateStore } from "./StateStore";
import { submitReview } from "./ReviewTalk";

// Finishing a review while an earlier finish is half done — on the pull
// request, not yet in the room — against the e2e's stand-in gh, with a room
// whose log takes comments only when told to.

const TICKET = "7b43481e-0000-4000-8000-000000000001";
const AT = "a".repeat(40);
const spot = { ticketId: TICKET, file: "src/export.ts", line: 2, side: "RIGHT" as const, commit: AT, ts: 1 };
const earlier: DraftComment = { ...spot, id: "a1", body: "on GitHub, not yet here", status: "posted", host: { id: 1999, url: "https://github.com/acme/sandbox/pull/7#discussion_r1999" } };
const fresh: DraftComment = { ...spot, id: "b1", line: 1, body: "a new thought", status: "pending" };

let dir = "";
const saved: Partial<Record<"COLLAGEN_GH" | "FAKE_GH_DIR", string | undefined>> = {};
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "review-talk-"));
  saved.COLLAGEN_GH = process.env.COLLAGEN_GH;
  saved.FAKE_GH_DIR = process.env.FAKE_GH_DIR;
  process.env.COLLAGEN_GH = join(import.meta.dirname, "../../e2e/fake-gh.mjs");
  process.env.FAKE_GH_DIR = dir;
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const reviewsPosted = () => (existsSync(join(dir, "reviews.log")) ? readFileSync(join(dir, "reviews.log"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { event: string; body?: string; comments: ReadonlyArray<{ body: string }> }) : []);

const make = (open: { taking: boolean }) => {
  const said: Array<ReviewComment> = [];
  const rooms = Layer.effect(
    Rooms,
    Effect.gen(function* () {
      const ticket = { id: TICKET, kind: "review", project: "sandbox", goal: "review it" } as unknown as Ticket;
      const review = { ticketId: TICKET, link: "https://github.com/acme/sandbox/pull/7", branch: "feat/stream-export", base: "main" } as unknown as ReviewContext;
      const room = {
        tickets: yield* SubscriptionRef.make<ReadonlyMap<string, Ticket>>(new Map([[TICKET, ticket]])),
        reviews: yield* SubscriptionRef.make<ReadonlyArray<ReviewContext>>([review]),
        writable: yield* SubscriptionRef.make(true),
        comment: (c: ReviewComment) => (open.taking ? Effect.sync(() => void said.push(c)) : Effect.fail(new NotWritable({ roomId: "testroom" }))),
      } as unknown as RoomHandle["room"];
      const handle: RoomHandle = { id: "testroom", room };
      return { handles: yield* SubscriptionRef.make<ReadonlyArray<RoomHandle>>([handle]) } as unknown as Rooms["Service"];
    }),
  );
  const store = Layer.effect(
    StateStore,
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make<LocalState>({
        preferredAi: null,
        rooms: { testroom: [{ id: "p1", name: "sandbox", path: dir }] },
        drafts: { [TICKET]: [earlier, fresh] },
        finished: { [TICKET]: ["finish-a"] },
      });
      return { state, update: (f: (s: LocalState) => LocalState) => SubscriptionRef.update(state, f).pipe(Effect.asVoid), get: SubscriptionRef.get(state) } as unknown as StateStore["Service"];
    }),
  );
  const identity = Layer.effect(
    IdentityService,
    Effect.gen(function* () {
      return { identity: { pubkey: "me" }, nameRef: yield* SubscriptionRef.make("alice") } as unknown as IdentityService["Service"];
    }),
  );
  const layer = Layer.mergeAll(rooms, store, identity);
  const drafts = StateStore.use((s) => s.get).pipe(Effect.map((s) => s.drafts?.[TICKET] ?? []));
  return { said, layer, drafts };
};

describe("a finish while an earlier one is half done", () => {
  it("the room still refusing: a new finish keeps its words and verdict, and says it was not sent", async () => {
    const open = { taking: false };
    const { drafts, layer, said } = make(open);
    const before = reviewsPosted().length;
    await Effect.runPromise(
      Effect.gen(function* () {
        const r = yield* submitReview(TICKET, "request-changes", "A new blocker.", AT, null, { id: "finish-b", pending: ["a1", "b1"] });
        expect(r).toEqual({ error: expect.stringContaining("Nothing of this finish was sent") });
        expect("onHost" in r).toBe(false);
        // the earlier one sent again: it is on the host, and says so
        const again = yield* submitReview(TICKET, "comment", "", AT, null, { id: "finish-a", pending: ["a1"] });
        expect(again).toMatchObject({ onHost: true });
        expect(reviewsPosted().length).toBe(before);
        expect((yield* drafts).map((d) => `${d.id}:${d.status}`)).toEqual(["a1:posted", "b1:pending"]);
        // the room takes it now: the earlier review is told, the new one sent as its own
        open.taking = true;
        const done = yield* submitReview(TICKET, "request-changes", "A new blocker.", AT, null, { id: "finish-b", pending: ["a1", "b1"] });
        expect(done).toMatchObject({ ok: true, said: 2 });
        const posted = reviewsPosted().slice(before);
        expect(posted).toHaveLength(1);
        expect(posted[0]).toMatchObject({ event: "REQUEST_CHANGES", body: "A new blocker.", comments: [{ body: "a new thought" }] });
        expect(said.map((c) => c.id)).toEqual(["a1", "b1"]);
        expect(yield* drafts).toEqual([]);
      }).pipe(Effect.provide(layer)),
    );
  });
});
