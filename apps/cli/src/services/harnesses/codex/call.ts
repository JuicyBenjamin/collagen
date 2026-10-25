import type { Turn } from "../../../lib/agents";

// Which call, which turn, which thread: Codex sends its thread (`threadId`)
// and the turn's model and effort (`x-codex-turn-metadata`) in each tool
// call's `_meta`.

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined);
const objectOf = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});

/** What a Codex call says of itself in its `_meta`: its thread, and the
 *  turn's model and effort (from its settings for that turn). Null when it
 *  says none of it. */
export const codexCall = (meta: unknown): { readonly turn: Turn; readonly thread?: string } | null => {
  const fields = objectOf(meta);
  const said = objectOf(fields["x-codex-turn-metadata"]);
  const model = text(said.model);
  const effort = text(said.reasoning_effort);
  const thread = text(fields.threadId);
  if (model === undefined && effort === undefined && thread === undefined) return null;
  return { turn: { ...(model ? { model } : {}), ...(effort ? { effort } : {}) }, ...(thread ? { thread } : {}) };
};
