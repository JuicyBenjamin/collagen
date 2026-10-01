import type { LocalState, Steering } from "@collagen/p2p";

/** Steering: how much the person's agent may do on its own with what
 *  collagen hands it — a step, a take, a peer's message. The person's
 *  setting, never the agent's; the asking end is the default, autonomy is
 *  opted into.
 *
 *  Collagen can only shape what it SAYS. The level travels in the words on
 *  every delivery the agent reads on the turn it is about to act (a step's
 *  text, get-messages, the resume nudge) — not in a tool description read
 *  once an hour ago. It gates no tool call: the harness's own permission mode
 *  is the hard stop, and this is the soft layer above it.
 *
 *  One thing no level changes: what is said in the ROOM for the person — a
 *  message, a take, a settle, a close — is their word, always. Steering is
 *  about the work in their repo. */

export const STEERING_ORDER: ReadonlyArray<Steering> = ["ask", "act", "auto"];

export const steeringOf = (s: Pick<LocalState, "steering">): Steering => s.steering ?? "ask";

export const nextSteering = (s: Steering): Steering => STEERING_ORDER[(STEERING_ORDER.indexOf(s) + 1) % STEERING_ORDER.length]!;

/** For the person: the status line, the settings page, the ? panel. */
export const STEERING_LABEL: Record<Steering, string> = {
  ask: "ask first",
  act: "act, then tell",
  auto: "just do it",
};

export const STEERING_HELP: Record<Steering, string> = {
  ask: "your agent tells you what collagen handed it and what it would do, and waits for your word",
  act: "your agent starts the work it was handed and tells you what it did as it goes",
  auto: "your agent does the work it was handed and tells you when it is done",
};

const ROOM = "Whatever the outcome, anything said in the room for your user — a message, a take, a settle, a close — still waits for their word.";

/** For the agent: the sentence that rides every delivery. */
export function steeringLine(level: Steering): string {
  switch (level) {
    case "ask":
      return "STEERING — ask first (your user's own setting): do not start on this. Tell your user what it asks and what you would do, and wait for their word.";
    case "act":
      return `STEERING — act, then tell (your user's own setting): you may start the work this asks for in your user's repo; tell them what you did as you go, and stop to ask where a choice is theirs. ${ROOM}`;
    case "auto":
      return `STEERING — just do it (your user's own setting): you may do the work this asks for on your own, and tell your user when it is done. ${ROOM}`;
  }
}
