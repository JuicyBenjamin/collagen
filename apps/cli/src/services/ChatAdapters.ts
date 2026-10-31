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

/** A path by its file's name alone. */
const fileName = (path: string): string => path.split("/").filter(Boolean).at(-1) ?? path;
/** Something quoted, kept short. */
const quoted = (text: string): string => `“${text.length > 40 ? `${text.slice(0, 39)}…` : text}”`;

/** A shell command as a person reads it, in a few words: git's reads by
 *  what they read ("Reading chat.ts at 552ddd3"), anything else by its
 *  program. Only its first command counts: what it pipes into is detail. */
export const commandDoing = (command: string): string => {
  // a harness may wrap it in a shell: bash -lc '…'
  const unwrapped = command.replace(/^\S*(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/, "$2").trim();
  const first = unwrapped.split(/\s*(?:&&|\|\||;|\|)\s*/)[0] ?? "";
  const words = first.split(/\s+/).filter(Boolean);
  const args = words.slice(1).filter((word) => !word.startsWith("-"));
  const program = fileName(words[0] ?? "");
  if (program === "git") {
    const [verb, ...rest] = args;
    const ref = rest[0] ?? "";
    const pathOf = () => rest.find((word) => word.includes("/") || word.includes("."));
    if (verb === "show") {
      const at = ref.indexOf(":");
      if (at > 0) return `Reading ${fileName(ref.slice(at + 1))} at ${ref.slice(0, Math.min(at, 7))}`;
      return ref ? `Reading commit ${ref.slice(0, 7)}` : "Reading the last commit";
    }
    if (verb === "log") return "Reading the history";
    if (verb === "diff") return "Comparing changes";
    if (verb === "blame") return pathOf() ? `Reading who changed ${fileName(pathOf()!)}` : "Reading who changed what";
    if (verb === "grep") return "Searching the code";
    return `Running git ${verb ?? ""}`.trim();
  }
  if (program === "rg" || program === "grep") return args[0] ? `Searching for ${quoted(args[0].replace(/^['"]|['"]$/g, ""))}` : "Searching the code";
  if (["cat", "head", "tail", "sed", "nl", "less"].includes(program)) {
    const path = args.filter((word) => word.includes("/") || word.includes(".")).at(-1);
    return path ? `Reading ${fileName(path)}` : "Reading a file";
  }
  if (program === "ls" || program === "find" || program === "tree") return "Looking through files";
  return program ? `Running ${program}` : "Working";
};

/** A tool call in a few words, as a person reads it: "Reading chat.ts",
 *  "Searching for “askAi”", "Reading the review". */
export const doingOf = (name: string, input: Record<string, unknown>): string => {
  const path = stringOf(input["file_path"]) ?? stringOf(input["path"]);
  const pattern = stringOf(input["pattern"]);
  const tool = name.replace(/^mcp__.*?__/, "");
  if (tool === "Read") return path ? `Reading ${fileName(path)}` : "Reading a file";
  if (tool === "Grep") return pattern ? `Searching for ${quoted(pattern)}` : "Searching the code";
  if (tool === "Glob") return "Looking through files";
  if (tool === "Bash") return commandDoing(stringOf(input["command"]) ?? "");
  if (tool === "review-context") return "Reading the review";
  if (tool === "get-tickets") return "Reading the tickets";
  return `Using ${tool}`;
};
