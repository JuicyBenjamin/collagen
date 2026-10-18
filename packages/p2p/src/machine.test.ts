import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { machineProblems, type ReviewMachine } from "./machine";
import { emptyReview, mergeReview, ReviewContext } from "./review";

// The page's parts arriving: each waits behind its placeholder until its own
// data comes, is swept in, and is shown.
const arriving: ReviewMachine = {
  title: "Each part shows when its own data comes",
  summary: "Every part runs the same three states.",
  sources: [
    { id: "github", name: "GitHub", gives: "the pull request" },
    { id: "git", name: "Git", gives: "the diff" },
  ],
  actors: [
    { id: "host", name: "Host bar", starts: "waiting" },
    { id: "code", name: "Code", starts: "waiting" },
  ],
  now: {
    states: [
      { id: "waiting", name: "Waiting", shows: "its placeholder" },
      { id: "arriving", name: "Arriving", shows: "its placeholder sweeping off it" },
      { id: "shown", name: "Shown", shows: "the part" },
    ],
    moves: [
      { from: "waiting", to: "arriving", on: "its data comes" },
      { from: "arriving", to: "shown", on: "sweep ends" },
    ],
    play: [
      { from: "github", moves: [{ actor: "host", to: "arriving" }], says: "GitHub sends the pull request." },
      { moves: [{ actor: "host", to: "shown" }], says: "The host bar is shown." },
      { from: "git", moves: [{ actor: "code", to: "arriving" }], says: "Git reads the diff." },
      { moves: [{ actor: "code", to: "shown" }], says: "The code is shown." },
    ],
  },
};

describe("a machine is checked before it goes on a review", () => {
  it("one that names only what it has, and plays only its own moves, can be drawn", () => {
    expect(machineProblems(arriving)).toEqual([]);
  });

  it("a beat moving a thing along a move the machine lacks is named, from where it was", () => {
    const skipping: ReviewMachine = { ...arriving, now: { ...arriving.now, play: [{ from: "github", moves: [{ actor: "host", to: "shown" }], says: "Straight in." }] } };
    expect(machineProblems(skipping)).toEqual(['now, beat 1: no move takes host from "waiting" to "shown"']);
  });

  it("a state, actor or source that is not there is named", () => {
    const broken: ReviewMachine = {
      ...arriving,
      actors: [...arriving.actors, { id: "header", name: "Header", starts: "kept" }],
      now: {
        ...arriving.now,
        moves: [...arriving.now.moves, { from: "shown", to: "gone", on: "closed" }],
        play: [{ from: "room", moves: [{ actor: "outline", to: "arriving" }], says: "?" }],
      },
    };
    expect(machineProblems(broken)).toEqual([
      'now: the move on "closed" names state "gone", which is not one',
      'now: Header starts in "kept", which is not one of its states',
      'now, beat 1: source "room" is not one',
      'now, beat 1: "outline" is not one of the actors',
    ]);
  });

  it("the version before the change is checked against its own states", () => {
    const before = { states: [{ id: "waiting", name: "Waiting", shows: "its placeholder" }, { id: "blank", name: "Blank", shows: "nothing" }], moves: [{ from: "waiting", to: "blank", on: "placeholder taken away" }], play: [{ moves: [{ actor: "host", to: "blank" }], says: "Gone." }] };
    expect(machineProblems({ ...arriving, before })).toEqual([]);
    expect(machineProblems({ ...arriving, before: { ...before, play: [{ moves: [{ actor: "host", to: "arriving" }], says: "?" }] } })).toEqual(['before, beat 1: "arriving" is not a state']);
  });
});

describe("a review's machine, stored", () => {
  const decode = Schema.decodeUnknownSync(ReviewContext);

  it("a review written before machines existed still decodes", () => {
    expect(decode({ ticketId: "t1", author: "k", authorName: "alice", summary: "s", decisions: [], forks: [], ts: 1 }).machine).toBeUndefined();
  });

  it("is replaced whole when given, kept when not, and withdrawn with null", () => {
    const drawn = mergeReview(emptyReview("t1", "k", "alice"), { machine: arriving }, 1);
    expect(decode(drawn).machine?.title).toBe("Each part shows when its own data comes");
    expect(mergeReview(drawn, { summary: "later" }, 2).machine).toEqual(arriving);
    expect(mergeReview(drawn, { machine: null }, 3).machine).toBeUndefined();
  });
});
