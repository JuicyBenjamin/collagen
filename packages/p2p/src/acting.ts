import { Schema } from "effect";

// Who of a person's AIs did something: the agent, as a person reads it, and
// the conversation it did it in — a Claude Code session, a Codex thread — so
// every peer knows not only that "Juicy's Claude Code" settled a step but
// which of Juicy's conversations did. The words are still the person's; this
// is attribution. Stamped where an act is written, from what the harness says
// on the tool call (cli lib/agents): never guessed, never typed in by the
// agent.

/** The AI tools collagen can tell a conversation of. */
export const Harness = Schema.Literals(["claude-code", "codex"]);
export type Harness = typeof Harness.Type;

/** One conversation of an AI: a Claude Code session id, a Codex thread id. */
export const Conversation = Schema.Struct({ ai: Harness, id: Schema.String });
export type Conversation = typeof Conversation.Type;

/** The agent acting for the person: its label ("Claude Code (Opus 5.5, high
 *  effort)") and, when the harness said it, the conversation. */
export interface Acting {
  readonly agent: string;
  readonly conversation?: Conversation;
}

/** A conversation as one comparable string, for keys and merge tiebreaks. */
export const conversationKey = (conversation: Conversation | undefined): string => (conversation ? `${conversation.ai}:${conversation.id}` : "");

/** A record as the acting agent leaves it: that agent and its conversation —
 *  or, when the person acted themselves, neither, so an earlier agent's name
 *  and conversation do not stay on words they did not write. */
export const withActing = <A extends { readonly agent?: string | undefined; readonly conversation?: Conversation | undefined }>(record: A, acting: Acting | undefined): A => {
  const { agent: _agent, conversation: _conversation, ...rest } = record;
  if (!acting) return rest as A;
  return { ...rest, agent: acting.agent, ...(acting.conversation ? { conversation: acting.conversation } : {}) } as A;
};

/** The fields an act carries on a record it creates: spread into it. */
export const actingFields = (acting: Acting | undefined): { readonly agent?: string; readonly conversation?: Conversation } =>
  acting ? { agent: acting.agent, ...(acting.conversation ? { conversation: acting.conversation } : {}) } : {};
