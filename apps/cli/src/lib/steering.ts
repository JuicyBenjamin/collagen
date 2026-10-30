import { Context, Effect } from "effect";
import type { LocalState, Steering, SteeringKind, SteeringLevels, SteeringPair, TagRoute } from "@collagen/p2p";

/** Steering: how far collagen and the person's agent may go on their own, in
 *  the person's name. Their setting, never the agent's; nothing is chosen
 *  until they choose, and autonomy is opted into.
 *
 *  A master level, and a level per kind under it that follows the master
 *  until set (SteeringKind) — each held twice: for what the person or their
 *  own agents caused (mine) and for what another person in the room caused
 *  (others). Others' never follows the person's own: what someone else
 *  writes is untrusted, and drives nothing they did not allow for it.
 *
 *  The other kinds are acts OUTSIDE collagen — the repo host, delivering
 *  into the person's AI conversations, running their AI for a job,
 *  starting it on an investigation (as one is filed, or reaches them from
 *  someone else), and telling the conversation that filed an investigation
 *  what was found (a delivery of its own, so findings can come back while
 *  other news waits). Not chosen, they do not happen, and the agent asks the
 *  person to choose. "never" is the person's own no: not done on its own,
 *  and nobody asks — only their own word does it. "ask first"
 *  hands the question back to the agent whose call would have done it; the
 *  agent asks its person and calls again with their yes. "act, then tell"
 *  does it and says so; "just do it" does it. Every write outside needs a
 *  permission (HostAllowed, DeliverAllowed, RunAllowed) only `allow` mints, so an act
 *  that skips steering does not compile.
 *
 *  The "work" kind is the soft layer it always was: the words on each
 *  delivery saying how much the agent may start on its own. It gates no tool
 *  call; the harness's own permission mode does.
 *
 *  One thing no level changes: what is said in the ROOM for the person — a
 *  message, a take, a settle, a close — is their word, always. */

/** A level, or none chosen. */
export type Level = Steering | "unset";
/** Who caused what is steered: the person or their own agents, or someone else. */
export type Cause = "mine" | "others";
/** Where a level is set: the master, or one kind. */
export type SteeringAt = "master" | SteeringKind;

export const STEERING_ORDER: ReadonlyArray<Steering> = ["never", "ask", "act", "auto"];
export const STEERING_KINDS: ReadonlyArray<SteeringKind> = ["work", "host", "deliver", "run", "investigate", "report"];
export const TAG_ROUTES: ReadonlyArray<TagRoute> = ["none", "existing", "existing-or-new", "new"];

/** The level in effect: the kind's own, else the master's, for that cause. */
export const levelOf = (state: Pick<LocalState, "steering">, kind: SteeringKind, cause: Cause): Level =>
  state.steering?.kinds?.[kind]?.[cause] ?? state.steering?.master?.[cause] ?? "unset";

/** The master level for a cause. */
export const masterOf = (state: Pick<LocalState, "steering">, cause: Cause = "mine"): Level => state.steering?.master?.[cause] ?? "unset";

/** Where a message for the person goes; not chosen, to a conversation that holds its thread. */
export const tagRouteOf = (state: Pick<LocalState, "steering">): TagRoute => state.steering?.tag ?? "existing";

/** Nothing chosen for acting outside collagen, for the person's own acts:
 *  no master, no repo-host level, no delivery level. */
export const unchosen = (state: Pick<LocalState, "steering">): boolean =>
  masterOf(state) === "unset" && state.steering?.kinds?.host?.mine === undefined && state.steering?.kinds?.deliver?.mine === undefined && state.steering?.kinds?.run?.mine === undefined && state.steering?.kinds?.investigate?.mine === undefined && state.steering?.kinds?.report?.mine === undefined;

const pairWith = (pair: SteeringPair | undefined, whose: Cause | "both", level: Steering | null): SteeringPair | undefined => {
  const causes: ReadonlyArray<Cause> = whose === "both" ? ["mine", "others"] : [whose];
  const next: { mine?: Steering; others?: Steering } = { ...pair };
  for (const cause of causes) {
    if (level === null) delete next[cause];
    else next[cause] = level;
  }
  return next.mine === undefined && next.others === undefined ? undefined : next;
};

/** The state with one level set, or given back to what it follows (null). */
export const withLevel = <S extends Pick<LocalState, "steering">>(state: S, at: SteeringAt, whose: Cause | "both", level: Steering | null): S => {
  const steering: SteeringLevels = state.steering ?? {};
  if (at === "master") {
    const { master: _was, ...rest } = steering;
    const master = pairWith(steering.master, whose, level);
    return { ...state, steering: { ...rest, ...(master ? { master } : {}) } };
  }
  const { [at]: _was, ...kinds } = steering.kinds ?? {};
  const pair = pairWith(steering.kinds?.[at], whose, level);
  return { ...state, steering: { ...steering, kinds: { ...kinds, ...(pair ? { [at]: pair } : {}) } } };
};

/** The state with where a tag goes set, or given back to its default (null). */
export const withTagRoute = <S extends Pick<LocalState, "steering">>(state: S, route: TagRoute | null): S => {
  const { tag: _was, ...rest } = state.steering ?? {};
  return { ...state, steering: { ...rest, ...(route ? { tag: route } : {}) } };
};

/** The next level round, from the TUI's key: not chosen starts at the asking end, and never comes after just do it. */
export const nextSteering = (level: Level): Steering =>
  level === "unset" ? "ask" : STEERING_ORDER[(STEERING_ORDER.indexOf(level) + 1) % STEERING_ORDER.length]!;

/** For the person: the status line, the ? panel, tool answers. */
export const STEERING_LABEL: Record<Level, string> = {
  unset: "not chosen",
  never: "never",
  ask: "ask first",
  act: "act, then tell",
  auto: "just do it",
};

export const KIND_LABEL: Record<SteeringKind, string> = {
  work: "work handed to your agent",
  host: "the repo host (reviews, comments, merges in your name)",
  deliver: "delivering into your AI conversations",
  run: "running your AI for a job (researching a ticket)",
  investigate: "starting your AI on an investigation (as one is filed, or asked of you)",
  report: "telling the conversation that filed an investigation what was found",
};

export const TAG_LABEL: Record<TagRoute, string> = {
  none: "nowhere: you ask for it",
  existing: "a conversation that holds its thread",
  "existing-or-new": "a conversation that holds its thread, else a new one",
  new: "always a new conversation",
};

export const STEERING_HELP: Record<Level, string> = {
  unset: "nothing is done outside collagen in your name, and your agent asks first",
  never: "not done on its own, and nobody asks: only your own word does it",
  ask: "your agent asks you before anything is done",
  act: "it is done, and you are told",
  auto: "it is done",
};

const ROOM = "Whatever the outcome, anything said in the room for your user — a message, a take, a settle, a close — still waits for their word.";

/** For the agent: the sentence that rides every delivery — how much it may
 *  start on its own with what it was handed (the work level). */
export function steeringLine(level: Level): string {
  switch (level) {
    case "unset":
      return "STEERING — not chosen yet, so ask first: do not start on this. Tell your user what it asks and what you would do, and wait for their word.";
    case "never":
      return "STEERING — never (your user's own setting): do not start on this, and do not offer to. Tell your user it came, in one line, and leave it to them.";
    case "ask":
      return "STEERING — ask first (your user's own setting): do not start on this. Tell your user what it asks and what you would do, and wait for their word.";
    case "act":
      return `STEERING — act, then tell (your user's own setting): you may start the work this asks for in your user's repo; tell them what you did as you go, and stop to ask where a choice is theirs. ${ROOM}`;
    case "auto":
      return `STEERING — just do it (your user's own setting): you may do the work this asks for on your own, and tell your user when it is done. ${ROOM}`;
  }
}

/** The work level's line for what someone caused. */
export const workLine = (state: Pick<LocalState, "steering">, cause: Cause): string => steeringLine(levelOf(state, "work", cause));

/** Said once to each conversation while nothing is chosen. */
export const UNCHOSEN_LINE =
  "STEERING NOT CHOSEN — your user has not said how far collagen may act outside itself in their name: on the repo host (reviews, comments, merges through their own gh) and in their AI conversations (delivering messages). Until they choose, it does none of it. Ask them once, in a line, and set it with set-steering (a master level, or one per kind: never, ask first, act then tell, just do it).";

// --- the permissions an act outside needs -------------------------------

declare const minted: unique symbol;
/** Proof that steering let an act outside through: who caused it, at which
 *  level. Only `allow` makes one. */
export interface Permit<K extends "host" | "deliver" | "report" | "run" | "investigate"> {
  readonly [minted]: K;
  readonly cause: Cause;
  readonly level: Steering;
}

/** Writing on the repo host in the person's name (a review, a comment, a merge) requires it. */
export class HostAllowed extends Context.Service<HostAllowed, Permit<"host">>()("cli/HostAllowed") {}
/** Delivering into the person's AI conversations requires it: its deliver
 *  level's permit, or for an investigation's findings, its report level's. */
export class DeliverAllowed extends Context.Service<DeliverAllowed, Permit<"deliver" | "report">>()("cli/DeliverAllowed") {}
/** Running the person's AI for a job of collagen's requires it: its run
 *  level's permit, or for an investigation, its investigate level's. */
export class RunAllowed extends Context.Service<RunAllowed, Permit<"run" | "investigate">>()("cli/RunAllowed") {}

/** What steering says to an act outside: go (with the permit to provide), or
 *  held — not chosen, never, or waiting on the person's yes. */
export type Gate<K extends "host" | "deliver" | "report" | "run" | "investigate"> =
  | { readonly go: Permit<K> }
  | { readonly held: "unset" | "never" | "ask"; readonly why: string };

/** Whether an act of `kind` caused by `cause` may happen now. `yes` is the
 *  person's own word for this one act, relayed by their agent: it lets "ask
 *  first" and "never" through, never "not chosen". */
export const allow = <K extends "host" | "deliver" | "report" | "run" | "investigate">(state: Pick<LocalState, "steering">, kind: K, cause: Cause, yes = false): Gate<K> => {
  const level = levelOf(state, kind, cause);
  const whose = cause === "mine" ? "your user's own" : "another person's";
  if (level === "unset")
    return { held: "unset", why: `steering for ${KIND_LABEL[kind]} is not chosen for ${whose} acts, so collagen does not do it in their name — have them choose one with set-steering` };
  if (level === "never" && !yes) return { held: "never", why: `steering for ${KIND_LABEL[kind]} is never for ${whose} acts: collagen does it only on their own word` };
  if (level === "ask" && !yes) return { held: "ask", why: `steering for ${KIND_LABEL[kind]} is ask first for ${whose} acts` };
  return { go: { level, cause } as unknown as Permit<K> };
};

/** A mock agent is collagen's own development dummy: delivering to it reaches
 *  nothing outside, so it needs no level. */
export const MOCK_PERMIT = { level: "auto", cause: "mine" } as unknown as Permit<"deliver">;

/** Run an act outside with its permit provided. */
export const withHost = <A, E, R>(permit: Permit<"host">, act: Effect.Effect<A, E, R>) => Effect.provideService(act, HostAllowed, permit);
export const withDeliver = <A, E, R>(permit: Permit<"deliver" | "report">, act: Effect.Effect<A, E, R>) => Effect.provideService(act, DeliverAllowed, permit);
export const withRun = <A, E, R>(permit: Permit<"run" | "investigate">, act: Effect.Effect<A, E, R>) => Effect.provideService(act, RunAllowed, permit);

/** Whose account an act on the repo host went through, and why it was let
 *  through — said wherever it is done. */
export const asYou = (permit: Permit<"host">, tool: string): string =>
  `as your user, through their own ${tool} (repo host: ${permit.level === "ask" || permit.level === "never" ? "they said yes" : STEERING_LABEL[permit.level]})`;
