import { Schema } from "effect";

// How a change works, as a machine its author's agent draws: the states a
// thing can be in, the moves between them, the things that run it, where
// what moves them comes from, and one walk-through, played on the review
// page. When the change alters a machine that was there, the version before
// it too, so the page can show what the change took out and put in.

/** A state, and what a person sees of a thing in it. */
export const MachineState = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  shows: Schema.String,
});
export type MachineState = typeof MachineState.Type;

/** A way from one state to another, and what takes it. */
export const MachineMove = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  on: Schema.String,
});
export type MachineMove = typeof MachineMove.Type;

/** Where what moves things comes from: a service, a person, a clock. */
export const MachineSource = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  gives: Schema.String,
});
export type MachineSource = typeof MachineSource.Type;

/** One thing that runs the machine — a part of a page, a ticket, a peer —
 *  and the state it starts in. */
export const MachineActor = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  starts: Schema.String,
});
export type MachineActor = typeof MachineActor.Type;

/** One moment of the walk-through: what came and from where, which things
 *  moved to which state, and what that means, in a sentence. */
export const MachineBeat = Schema.Struct({
  from: Schema.optional(Schema.String),
  moves: Schema.optional(Schema.Array(Schema.Struct({ actor: Schema.String, to: Schema.String }))),
  says: Schema.String,
});
export type MachineBeat = typeof MachineBeat.Type;

/** The machine as one version of the code has it. */
export const MachineVersion = Schema.Struct({
  states: Schema.Array(MachineState),
  moves: Schema.Array(MachineMove),
  play: Schema.Array(MachineBeat),
});
export type MachineVersion = typeof MachineVersion.Type;

/** A review's machine. `before` only when the change alters one that was
 *  there; a machine the change brings in has none. */
export const ReviewMachine = Schema.Struct({
  title: Schema.String,
  summary: Schema.String,
  sources: Schema.Array(MachineSource),
  actors: Schema.Array(MachineActor),
  now: MachineVersion,
  before: Schema.optional(MachineVersion),
});
export type ReviewMachine = typeof ReviewMachine.Type;

const repeated = (ids: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

/** What is wrong with one version, said for the agent that drew it: every
 *  name it points at must exist, and the walk-through only takes moves the
 *  machine has, from where each thing is at that point. */
const versionProblems = (machine: ReviewMachine, version: MachineVersion, label: string): ReadonlyArray<string> => {
  const problems: Array<string> = [];
  const states = new Set(version.states.map((state) => state.id));
  const sources = new Set(machine.sources.map((source) => source.id));
  if (version.states.length === 0) problems.push(`${label}: no states`);
  for (const id of repeated(version.states.map((state) => state.id))) problems.push(`${label}: state "${id}" is given twice`);
  for (const move of version.moves)
    for (const end of [move.from, move.to]) if (!states.has(end)) problems.push(`${label}: the move on "${move.on}" names state "${end}", which is not one`);
  const at = new Map<string, string>();
  for (const actor of machine.actors) {
    if (states.has(actor.starts)) at.set(actor.id, actor.starts);
    else problems.push(`${label}: ${actor.name} starts in "${actor.starts}", which is not one of its states`);
  }
  if (version.play.length === 0) problems.push(`${label}: the play has no beats`);
  version.play.forEach((beat, index) => {
    const where = `${label}, beat ${index + 1}`;
    if (beat.from !== undefined && !sources.has(beat.from)) problems.push(`${where}: source "${beat.from}" is not one`);
    for (const step of beat.moves ?? []) {
      const from = at.get(step.actor);
      if (!machine.actors.some((actor) => actor.id === step.actor)) problems.push(`${where}: "${step.actor}" is not one of the actors`);
      else if (!states.has(step.to)) problems.push(`${where}: "${step.to}" is not a state`);
      else if (from !== undefined && !version.moves.some((move) => move.from === from && move.to === step.to))
        problems.push(`${where}: no move takes ${step.actor} from "${from}" to "${step.to}"`);
      if (states.has(step.to)) at.set(step.actor, step.to);
    }
  });
  return problems;
};

/** Everything wrong with a machine before it goes on a review; none, and it
 *  can be drawn and played as given. */
export const machineProblems = (machine: ReviewMachine): ReadonlyArray<string> => [
  ...(machine.actors.length === 0 ? ["no actors: name what runs the machine"] : []),
  ...repeated(machine.actors.map((actor) => actor.id)).map((id) => `actor "${id}" is given twice`),
  ...repeated(machine.sources.map((source) => source.id)).map((id) => `source "${id}" is given twice`),
  ...versionProblems(machine, machine.now, "now"),
  ...(machine.before ? versionProblems(machine, machine.before, "before") : []),
];
