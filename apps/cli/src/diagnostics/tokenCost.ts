import { Clock, Effect, Schema, SubscriptionRef } from "effect";
import { encode as toToon } from "@toon-format/toon";
import { visibleTo, type OwnRun } from "@collagen/p2p";
import { byTool, callsOn, compact, readSessions, tokensOf, type Call, type SessionCost } from "../lib/tokenCost";
import { homesOf } from "../services/Harness";
import { diagnostic } from "./registry";

const DAY = 24 * 60 * 60 * 1000;
const pct = (part: number, whole: number) => (whole === 0 ? "0%" : `${((100 * part) / whole).toFixed(part * 1000 < whole ? 2 : 1)}%`);
const name = (session: SessionCost) => session.file.replace(/^.*\//, "").replace(/\.jsonl$/, "");
const chars = (calls: ReadonlyArray<Call>) => calls.reduce((sum, call) => sum + call.argChars + call.resultChars, 0);
/** Rows per table: what this returns is itself read by an AI, so it gives the
 *  largest and says how many there were. */
const ROWS = 20;
const most = <Row>(label: string, rows: ReadonlyArray<Row>) => (rows.length > ROWS ? `${label} (the ${ROWS} largest of ${rows.length})` : label);

/** What collagen costs the AIs on this machine, read from their own logs. */
export const tokenCost = diagnostic<{ readonly ticketId?: string; readonly days?: number }>({
  id: "token-cost",
  title: "token cost",
  summary:
    "What collagen costs the AI in tokens, read from the session logs its AI tool keeps on this machine (nothing leaves it; only counts and sizes are read out). Per collagen tool: calls and roughly how many tokens went in and came back; per session: tokens read in all and collagen's share of them; each time an AI ran out of context window, what collagen had put into it just before; and the standing size of collagen's tool definitions. Pass ticketId to count only the calls that named that ticket; days (default 30) for how far back.",
  params: Schema.Struct({ ticketId: Schema.optional(Schema.String), days: Schema.optional(Schema.Finite) }),
  fromContext: (context) => (context.ticketId ? { ticketId: context.ticketId } : null),
  run: ({ ticketId, days: asked = 30 }, context, { rooms, me, toolDefinitions, harnesses, state }) =>
    Effect.gen(function* () {
      const days = Math.max(1, Math.round(asked));
      if (ticketId !== undefined) {
        const handle = (yield* SubscriptionRef.get(rooms.handles)).find((roomHandle) => roomHandle.id === context.roomId);
        const all = handle ? yield* SubscriptionRef.get(handle.room.tickets) : new Map();
        const ticket = all.get(ticketId);
        if (!ticket || !visibleTo(ticket, all, me)) return `failed: no ticket ${ticketId} — check get-tickets`;
      }
      const since = (yield* Clock.currentTimeMillis) - days * DAY;
      const sessions = yield* Effect.promise(() => readSessions(harnesses, homesOf(harnesses), since));
      const ownRuns = ((yield* state).ownRuns ?? []).filter((run) => run.at >= since);
      return ticketId === undefined ? overall(sessions, days, toolDefinitions, ownRuns) : onTicket(sessions, ticketId, days);
    }),
});

const toolRows = (calls: ReadonlyArray<Call>) =>
  byTool(calls).map((total) => ({
    tool: total.tool,
    kind: total.kind,
    calls: total.calls,
    tokensIn: tokensOf(total.argChars),
    tokensOut: tokensOf(total.resultChars),
    largestOut: tokensOf(total.largestResult),
  }));

function onTicket(sessions: ReadonlyArray<SessionCost>, ticketId: string, days: number): string {
  const touched = sessions.map((session) => ({ session, calls: callsOn(session.calls, ticketId) })).filter((touch) => touch.calls.length > 0);
  const calls = touched.flatMap((touch) => touch.calls);
  const head = `${calls.length} calls · ≈${compact(tokensOf(chars(calls)))} tokens · ${touched.length} sessions · last ${days} days`;
  if (calls.length === 0) return head;
  return [head, toToon({ tools: toolRows(calls) }), toToon({ sessions: touched.map(({ session, calls }) => ({ ai: session.ai, session: name(session), calls: calls.length, tokens: tokensOf(chars(calls)) })) })].join("\n\n");
}

/** What collagen spent on model runs of its own (couriers waking a
 *  conversation), beside what its words cost the agents. */
function ownRunsPart(runs: ReadonlyArray<OwnRun>): string {
  const input = runs.reduce((sum, run) => sum + run.inputTokens, 0);
  const output = runs.reduce((sum, run) => sum + run.outputTokens, 0);
  const priced = runs.filter((run) => run.costUsd !== undefined);
  const cost = priced.reduce((sum, run) => sum + (run.costUsd ?? 0), 0);
  const byModel = [...new Set(runs.map((run) => run.model ?? "unknown"))].map((model) => {
    const these = runs.filter((run) => (run.model ?? "unknown") === model);
    return { model, runs: these.length, tokensIn: these.reduce((sum, run) => sum + run.inputTokens, 0), tokensOut: these.reduce((sum, run) => sum + run.outputTokens, 0) };
  });
  return (
    `collagen's own runs: ${runs.length} wakes · ${compact(input)} tokens in · ${compact(output)} out${priced.length > 0 ? ` · $${cost.toFixed(2)} (the harness's estimate${priced.length < runs.length ? `, for ${priced.length} of them` : ""})` : ""}\n` +
    toToon({ ownRunsByModel: byModel })
  );
}

function overall(sessions: ReadonlyArray<SessionCost>, days: number, definitions: ReadonlyArray<{ readonly name: string; readonly chars: number }> | undefined, ownRuns: ReadonlyArray<OwnRun>): string {
  const calls = sessions.flatMap((session) => session.calls);
  const read = sessions.reduce((sum, session) => sum + session.inputTokens, 0);
  const ours = sessions.reduce((sum, session) => sum + session.collagenInputTokens, 0);
  const breaks = sessions.flatMap((session) => session.breaks.map((contextBreak) => ({ session, contextBreak })));
  const head = `≈${compact(ours)} of ${compact(read)} tokens read (${pct(ours, read)}) · ${calls.length} calls · ${sessions.length} sessions · ${breaks.length} window breaks · last ${days} days`;
  const parts = [head];
  if (calls.length > 0) {
    parts.push(toToon({ tools: toolRows(calls) }));
    const ranked = [...sessions].sort((a, b) => b.collagenInputTokens - a.collagenInputTokens).slice(0, ROWS);
    parts.push(
      toToon({
        [most("sessions", sessions)]: ranked.map((session) => ({
          ai: session.ai,
          session: name(session),
          calls: session.calls.length,
          replies: session.replies,
          tokensRead: session.inputTokens,
          collagenShare: pct(session.collagenInputTokens, session.inputTokens),
          peakWindow: session.peakWindow,
          window: session.contextWindow ?? "",
          breaks: session.breaks.length,
        })),
      }),
    );
  }
  if (breaks.length > 0) {
    const worst = [...breaks].sort((a, b) => b.contextBreak.collagenChars - a.contextBreak.collagenChars).slice(0, ROWS);
    parts.push(
      toToon({
        [most("breaks", breaks)]: worst.map(({ session, contextBreak }) => ({
          ai: session.ai,
          session: name(session),
          at: contextBreak.at ?? "",
          how: contextBreak.how,
          windowBefore: contextBreak.windowBefore ?? "",
          collagenCalls: contextBreak.collagenCalls,
          collagenTokens: tokensOf(contextBreak.collagenChars),
          largest: contextBreak.largest ? `${contextBreak.largest.tool} ≈${tokensOf(contextBreak.largest.chars)}` : "",
          ticketsTouched: contextBreak.ticketsTouched,
        })),
      }),
    );
  }
  if (ownRuns.length > 0) parts.push(ownRunsPart(ownRuns));
  if (definitions && definitions.length > 0) {
    const total = definitions.reduce((sum, definition) => sum + definition.chars, 0);
    const largest = [...definitions].sort((a, b) => b.chars - a.chars).slice(0, 10);
    parts.push(
      `definitions: ≈${compact(tokensOf(total))} tokens for ${definitions.length} tools, in the window whenever the AI loads them\n` +
        toToon({ largestDefinitions: largest.map((definition) => ({ tool: definition.name, tokens: tokensOf(definition.chars) })) }),
    );
  }
  parts.push(
    "Method: real token counts come from the logs, and collagen's own runs from what each run reported; collagen's share of them is estimated at 4 characters a token — each call's arguments and result, counted on every reply they stay in the window, until the window is compacted. A break is a compaction the AI did on its own or a request refused as too long; ticketsTouched is how many tickets the calls before it named.",
  );
  return parts.join("\n\n");
}
