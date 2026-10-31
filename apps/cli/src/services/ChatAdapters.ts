import { Option } from "effect";

// The reader's own AI, asked about the code on the review page (ReviewChat):
// the same CLI they run, in their clone, read-only — its answer read off its
// stdout line by line as it writes it, so the page shows it growing. One
// reader per CLI: each says, in its own event format, the conversation's id
// (to resume it for the next question), text as it comes, what it is doing
// between (a file read, a command), its final answer, or why it failed.

export interface ChatCtx {
  readonly cwd: string;
  readonly prompt: string;
  /** the conversation to go on with — none: a new one */
  readonly sessionId: Option.Option<string>;
  readonly mcpUrl: string;
  readonly serverName: string;
  /** the model chosen for chats — none: the CLI's own */
  readonly model: Option.Option<string>;
}

export type ChatEvent =
  | { readonly kind: "session"; readonly id: string }
  /** text as it is written; `block`: it starts a new paragraph of the answer */
  | { readonly kind: "text"; readonly text: string; readonly block: boolean }
  | { readonly kind: "doing"; readonly what: string }
  /** the whole answer, as the CLI gives it at the end — it replaces what streamed */
  | { readonly kind: "final"; readonly text: string }
  | { readonly kind: "failed"; readonly error: string };

export interface ChatAdapter {
  readonly cmd: string;
  readonly args: (o: ChatCtx) => ReadonlyArray<string>;
  /** one line of the CLI's stdout, as events — none for a line that says nothing to the page */
  readonly read: (line: string) => ReadonlyArray<ChatEvent>;
}

export const json = (line: string): Record<string, unknown> | null => {
  if (!line.trim().startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
export const stringOf = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
export const rec = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});

/** A tool call in a word or two and its target: "Read src/a.ts", "git show …". */
export const doingOf = (name: string, input: Record<string, unknown>): string => {
  const target = stringOf(input["file_path"]) ?? stringOf(input["path"]) ?? stringOf(input["pattern"]) ?? stringOf(input["command"]) ?? "";
  const short = name.replace(/^mcp__.*?__/, "");
  return `${short} ${target}`.trim().slice(0, 160);
};
