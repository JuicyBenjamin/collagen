import { Effect, Layer, Ref, Stream } from "effect";
import { LanguageModel, type Prompt, type Response } from "effect/unstable/ai";

/** One model turn, decided in advance: tool calls to make, text to say. */
export interface Turn {
  readonly text?: string;
  readonly calls?: ReadonlyArray<{ readonly name: string; readonly params: unknown }>;
}

/** What the model was shown on a turn — the test's window on "what we tell the AI". */
export interface Seen {
  readonly prompt: string;
  readonly tools: ReadonlyArray<{ readonly name: string; readonly description: string }>;
}

const promptText = (prompt: Prompt.Prompt): string =>
  prompt.content
    .map((m) =>
      typeof m.content === "string"
        ? `${m.role}: ${m.content}`
        : `${m.role}: ${m.content.map((p) => ("text" in p && typeof p.text === "string" ? p.text : `[${p.type}]`)).join(" ")}`,
    )
    .join("\n");

/** A LanguageModel that plays a script — Effect's own extension point
 *  (`LanguageModel.make`) with the provider replaced by a list of turns.
 *  Tests use it to run the real tool definitions and handlers under an agent
 *  that does what the prompts say, and to inspect exactly what the prompts
 *  said. It proves nothing about a real model's obedience; that is not what
 *  tests are for. */
export const scriptedModel = (turns: ReadonlyArray<Turn>) =>
  Effect.gen(function* () {
    const remaining = yield* Ref.make<ReadonlyArray<Turn>>(turns);
    const seen = yield* Ref.make<ReadonlyArray<Seen>>([]);
    const service = yield* LanguageModel.make({
      generateText: (options) =>
        Effect.gen(function* () {
          const turn = yield* Ref.modify(remaining, (t) => [t[0], t.slice(1)] as const);
          if (!turn) return yield* Effect.die("scripted model: no turns left");
          yield* Ref.update(seen, (s) => [
            ...s,
            { prompt: promptText(options.prompt), tools: options.tools.map((t) => ({ name: t.name, description: t.description ?? "" })) },
          ]);
          const parts: Array<Response.PartEncoded> = [];
          (turn.calls ?? []).forEach((c, i) => {
            parts.push({ type: "tool-call", id: `call_${i}`, name: c.name, params: c.params, providerExecuted: false });
          });
          if (turn.text !== undefined) parts.push({ type: "text", text: turn.text });
          parts.push({
            type: "finish",
            reason: (turn.calls?.length ?? 0) > 0 ? "tool-calls" : "stop",
            usage: { inputTokens: {}, outputTokens: {} },
          });
          return parts;
        }),
      streamText: () => Stream.die("scripted model: streaming is not scripted"),
    });
    return { layer: Layer.succeed(LanguageModel.LanguageModel, service), seen: Ref.get(seen) } as const;
  });
