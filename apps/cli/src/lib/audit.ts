import { closedAs, type LocalState, type OwnRun, type ReviewContext, type Ticket } from "@collagen/p2p";
import type { AuditPage } from "@collagen/review-web/data";
import { modelName, modelOfLabel } from "./agents";
import { levelOf, STEERING_KINDS, STEERING_LABEL } from "./steering";
import { byTool, tokensOf, type SessionCost } from "./tokenCost";

// The audit page's numbers (review-web, /audit/<roomId>): what collagen
// put into the AIs' windows on this machine, tool by tool and call by call,
// what it ran itself, and the room's tickets, models and steering — counted
// here, drawn there.

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
/** How many tools' calls are sent one by one: the busiest. */
const PER_CALL_TOOLS = 8;
/** A tool counts as growing when its last week's calls are this much bigger. */
const GROWTH = 1.15;

const JOB_WORDS: Record<OwnRun["why"], string> = { wake: "Wakes", research: "Research", investigation: "Investigations" };

export interface AuditInput {
  readonly room: string;
  readonly days: number;
  readonly now: number;
  readonly sessions: ReadonlyArray<SessionCost>;
  readonly harnessName: (id: string) => string;
  readonly ownRuns: ReadonlyArray<OwnRun>;
  readonly tickets: ReadonlyArray<Ticket>;
  readonly reviews: ReadonlyArray<ReviewContext>;
  readonly all: ReadonlyMap<string, Ticket>;
  readonly state: Pick<LocalState, "steering">;
  readonly definitions: ReadonlyArray<{ readonly name: string; readonly chars: number }>;
}

const mean = (values: ReadonlyArray<number>): number => (values.length === 0 ? 0 : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length));

export const auditPage = (input: AuditInput): AuditPage => {
  const calls = input.sessions.flatMap((session) => session.calls);
  const timed = calls.flatMap((call) => (call.at ? [{ tool: call.tool, at: call.at, tokens: tokensOf(call.argChars + call.resultChars), time: Date.parse(call.at) }] : []));
  const totals = byTool(calls);
  const busiest = [...totals].sort((a, b) => b.calls - a.calls).slice(0, PER_CALL_TOOLS).map((total) => total.tool);
  // growing: the last week's calls against the three weeks before, by tool
  const lastWeek = input.now - WEEK;
  const before = input.now - 4 * WEEK;
  const growing = totals
    .flatMap((total) => {
      const of = timed.filter((call) => call.tool === total.tool);
      const recent = of.filter((call) => call.time >= lastWeek).map((call) => call.tokens);
      const earlier = of.filter((call) => call.time >= before && call.time < lastWeek).map((call) => call.tokens);
      if (recent.length < 3 || earlier.length < 3) return [];
      const from = mean(earlier);
      const to = mean(recent);
      if (from === 0 || to < from * GROWTH) return [];
      const weeks = [3, 2, 1, 0].map((back) => mean(of.filter((call) => call.time >= input.now - (back + 1) * WEEK && call.time < input.now - back * WEEK).map((call) => call.tokens)));
      return [{ tool: total.tool, from, to, weeks }];
    })
    .sort((a, b) => b.to / b.from - a.to / a.from)
    .slice(0, 4);
  const breaks = input.sessions.flatMap((session) => session.breaks);
  const read = input.sessions.reduce((sum, session) => sum + session.inputTokens, 0);
  const ours = input.sessions.reduce((sum, session) => sum + session.collagenInputTokens, 0);
  const priced = input.ownRuns.filter((run) => run.costUsd !== undefined);
  const jobs = [...new Set(input.ownRuns.map((run) => `${run.why} ${run.model ?? ""}`))].map((key) => {
    const these = input.ownRuns.filter((run) => `${run.why} ${run.model ?? ""}` === key);
    const first = these[0]!;
    return {
      kind: JOB_WORDS[first.why],
      model: first.model ? (modelOfLabel(`(${modelName(first.model)})`) ?? first.model) : "",
      runs: these.length,
      tokensIn: these.reduce((sum, run) => sum + run.inputTokens, 0),
      tokensOut: these.reduce((sum, run) => sum + run.outputTokens, 0),
    };
  });
  const harnesses = [...new Set(input.sessions.map((session) => session.ai))].map((ai) => ({ name: input.harnessName(ai), sessions: input.sessions.filter((session) => session.ai === ai).length }));
  // the room's records, by the model of the agent that wrote each
  const labels = [
    ...input.tickets.flatMap((ticket) => [ticket.agent, ...ticket.steps.map((step) => step.agent)]),
    ...input.reviews.map((review) => review.agent),
  ].flatMap((label) => (label ? [modelOfLabel(label)] : [])).filter((model): model is string => model !== undefined);
  const models = [...new Set(labels)].map((name) => ({ name, acts: labels.filter((label) => label === name).length })).sort((a, b) => b.acts - a.acts);
  const kinds = [...new Set(input.tickets.map((ticket) => ticket.kind))];
  const tickets = kinds
    .map((kind) => {
      const of = input.tickets.filter((ticket) => ticket.kind === kind);
      const closed = of.filter((ticket) => closedAs(ticket) !== null).length;
      return { kind: kind[0]!.toUpperCase() + kind.slice(1), open: of.length - closed, closed };
    })
    .sort((a, b) => b.open + b.closed - (a.open + a.closed));
  const definitionChars = input.definitions.reduce((sum, definition) => sum + definition.chars, 0);
  return {
    room: input.room,
    days: input.days,
    totals: {
      calls: calls.length,
      sessions: input.sessions.length,
      collagenTokens: ours,
      allTokens: read,
      compactions: breaks.length,
      jobs: input.ownRuns.length,
      jobCost: priced.length > 0 ? priced.reduce((sum, run) => sum + (run.costUsd ?? 0), 0) : null,
      tickets: input.tickets.length,
      openTickets: input.tickets.filter((ticket) => closedAs(ticket) === null).length,
    },
    perCall: busiest.map((tool) => ({ tool, calls: timed.filter((call) => call.tool === tool).map((call) => ({ at: call.at, tokens: call.tokens })) })),
    growing,
    tools: totals.map((total) => ({ tool: total.tool, kind: total.kind, calls: total.calls, tokensIn: tokensOf(total.argChars), tokensOut: tokensOf(total.resultChars) })),
    harnesses,
    models,
    jobs,
    compactions: breaks.flatMap((contextBreak) => (contextBreak.at ? [{ at: contextBreak.at, collagenTokens: tokensOf(contextBreak.collagenChars) }] : [])).sort((a, b) => a.at.localeCompare(b.at)),
    tickets,
    steering: STEERING_KINDS.map((kind) => ({ kind, mine: STEERING_LABEL[levelOf(input.state, kind, "mine")], others: STEERING_LABEL[levelOf(input.state, kind, "others")] })),
    sessions: [...input.sessions]
      .sort((a, b) => b.calls.length - a.calls.length)
      .slice(0, 10)
      .map((session) => ({ id: session.file.replace(/^.*\//, "").replace(/\.jsonl$/, "").slice(0, 8), harness: input.harnessName(session.ai), calls: session.calls.length, share: session.inputTokens === 0 ? 0 : session.collagenInputTokens / session.inputTokens, compactions: session.breaks.length })),
    definitions: {
      tools: input.definitions.length,
      tokens: tokensOf(definitionChars),
      largest: [...input.definitions].sort((a, b) => b.chars - a.chars).slice(0, 10).map((definition) => ({ tool: definition.name, tokens: tokensOf(definition.chars) })),
    },
  };
};
