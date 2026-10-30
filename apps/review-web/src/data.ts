// The contract between the collagen instance and the review page: what
// the page's server functions (src/api.ts) answer. It lives with the page,
// and the cli imports it (apps/cli/src/lib/reviewView, services/ReviewView), so the two
// sides cannot drift. Plain types, no runtime: nothing here is bundled into
// the cli.

export interface DiffLine {
  readonly kind: "+" | "-" | " ";
  readonly text: string;
  /** line number in the old file (context and removed lines) */
  readonly old?: number;
  /** line number in the new file (context and added lines) */
  readonly new?: number;
}

export interface Hunk {
  /** stable within one diff: `<file>#<n>` */
  readonly id: string;
  /** the file's new path (old path for a deletion) */
  readonly file: string;
  readonly header: string;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: ReadonlyArray<DiffLine>;
}

/** What an old ticket's decision, filed before titles, shows in its place. */
export const NO_TITLE = "Old ticket — no title";

/** A decision behind the change, as the review's why records it. */
export interface Decision {
  readonly id: string;
  /** Its headline, a few words; absent only on an old ticket's. */
  readonly title?: string;
  /** What was done, in a line — beneath the title. */
  readonly what: string;
  readonly userWhy?: string;
  readonly agentWhy?: string;
  readonly where: ReadonlyArray<string>;
  /** the skills and agent files that told the agent to do it this way */
  readonly guidedBy?: ReadonlyArray<string>;
  /** on a review built from assumptions: what the guess rests on, and how sure the AI is */
  readonly basis?: string;
  readonly confidence?: Confidence;
  /** once the code's author took it over: what they made of the guess (absent: still a guess) */
  readonly verdict?: GuessVerdict;
  /** the guess a correction replaced */
  readonly guess?: Guess;
}

/** What the code's author made of a guess. */
export type GuessVerdict = "confirmed" | "corrected" | "wrong";

/** A guess as the AI made it, kept beside the decision that replaced it. */
export interface Guess {
  readonly what: string;
  readonly why?: string;
  readonly basis?: string;
}

/** How sure an AI is of something it inferred rather than was told. */
export type Confidence = "high" | "medium" | "low";

/** A review built from assumptions: who wrote the code (not on collagen),
 *  and what the reader's AI read to infer the why. */
export interface Assumed {
  readonly author: string;
  readonly sources: ReadonlyArray<string>;
}

/** A fork in the road: chosen over what, why, whose call. */
export interface Fork {
  readonly id: string;
  readonly at: string;
  readonly chose: string;
  readonly instead: string;
  readonly why: string;
  readonly by?: "user" | "agent";
  readonly basis?: string;
  readonly confidence?: Confidence;
  readonly verdict?: GuessVerdict;
  readonly guess?: Guess;
}

/** A unit of the change: code that together achieves one thing, each hunk
 *  of the diff in exactly one unit, titled by what it achieves. Named by the
 *  author's agent; where it named none, a decision's code is its own unit,
 *  titled by the decision; what no decision covers is "Not explained". */
export interface Unit {
  readonly id: string;
  /** what it achieves — never a file name */
  readonly title: string;
  /** the line beneath the title */
  readonly what: string;
  readonly by: "author" | "decision" | "unexplained";
  /** hunk ids, a file's together, in diff order */
  readonly hunks: ReadonlyArray<string>;
  /** the decisions whose lines fall in this unit, by id, in the why's order */
  readonly decisions: ReadonlyArray<string>;
  /** the forks whose `at` falls in this unit's hunks */
  readonly forks: ReadonlyArray<Fork>;
  /** hunks here no decision covers — worth a question to the author */
  readonly unexplained: ReadonlyArray<string>;
  /** a group of repeated uses: files that only apply another unit's change,
   *  read and marked viewed together. `of`: that unit's id, when it is in
   *  the review; `differs`: the files whose changes are not the same as the
   *  rest's — a wrong grouping must not hide a real difference */
  readonly uses?: { readonly of?: string; readonly differs: ReadonlyArray<string> };
}

/** A test this diff adds, changes or removes: judged by its title — what it
 *  claims to protect — with its code one step away. */
export interface TestCase {
  /** its file and titles: what a reader's mark on it follows across pushes */
  readonly id: string;
  readonly file: string;
  /** the describes it sits in, outermost first */
  readonly under: ReadonlyArray<string>;
  readonly title: string;
  readonly change: "added" | "changed" | "removed";
  /** the whole test as one hunk, the lines this diff adds or removes marked */
  readonly code: Hunk;
}

/** A test file of the diff: its tests that changed, its hunks in no test
 *  (imports, helpers, setup), and the decisions and forks pointing into it. */
export interface TestFile {
  readonly file: string;
  readonly tests: ReadonlyArray<TestCase>;
  /** hunk ids */
  readonly other: ReadonlyArray<string>;
  /** decision ids */
  readonly decisions: ReadonlyArray<string>;
  readonly forks: ReadonlyArray<Fork>;
}

export interface Grouped {
  /** in reading order: what something is built from before what uses it —
   *  test files are in none: they are `tests` */
  readonly units: ReadonlyArray<Unit>;
  /** the diff's test files, apart from the code */
  readonly tests: ReadonlyArray<TestFile>;
  readonly hunks: ReadonlyArray<Hunk>;
  /** per decision id, its pointers that matched no change: the code there
   *  did not move, or the why is older than the branch */
  readonly unmatched: Readonly<Record<string, ReadonlyArray<string>>>;
  /** forks that fall in no hunk of the diff */
  readonly looseForks: ReadonlyArray<Fork>;
  /** decisions in no unit, by id: their pointers match no change (stale
   *  after an edit or a rebase), or they point at none — still shown, the
   *  why is the review's whether or not the diff carries its code */
  readonly outside: ReadonlyArray<string>;
}

/** Where the change can be seen running: a page to open. */
export interface Show {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  /** a loopback address: it runs on its author's machine */
  readonly local: boolean;
}

/** How a change works: states, the moves between them, the things that run
 *  it and where what moves them comes from, with one walk-through. `before`
 *  when the change alters a machine that was there. */
export interface Machine {
  readonly title: string;
  readonly summary: string;
  readonly sources: ReadonlyArray<{ readonly id: string; readonly name: string; readonly gives: string }>;
  readonly actors: ReadonlyArray<{ readonly id: string; readonly name: string; readonly starts: string }>;
  readonly now: MachineVersion;
  readonly before?: MachineVersion;
}

/** The machine as one version of the code has it. */
export interface MachineVersion {
  readonly states: ReadonlyArray<{ readonly id: string; readonly name: string; readonly shows: string }>;
  readonly moves: ReadonlyArray<{ readonly from: string; readonly to: string; readonly on: string }>;
  readonly play: ReadonlyArray<{ readonly from?: string; readonly moves?: ReadonlyArray<{ readonly actor: string; readonly to: string }>; readonly says: string }>;
}

/** How the reader last finished a review: their verdict, in the host's
 *  words, or — on one they filed — how they closed it. */
export type ReviewedAs = "approved" | "changes requested" | "commented" | "accepted" | "dropped";

/** The reader's own finish of a review: what, when (ms), and whether the
 *  change moved after it (a push, its why revised), so another is due. */
export interface YourReview {
  readonly as: ReviewedAs;
  readonly at: number;
  readonly since: boolean;
  /** how many comments the reader has said on the review */
  readonly comments?: number;
}

/** The review's own part of the page: its ticket, its why and its links,
 *  known as soon as the room is read — the diff comes after. */
export interface ReviewPageHead {
  /** `mine`: the reader filed it — theirs to accept or drop; `closed`: it is over;
   *  `yours`: the reader's own finish of it in the room, when there is one */
  readonly ticket: { readonly id: string; readonly title?: string; readonly goal: string; readonly kind: string; readonly project: string; readonly mine: boolean; readonly closed: boolean; readonly yours?: YourReview };
  readonly review: {
    readonly summary: string;
    readonly branch?: string;
    readonly base?: string;
    readonly link?: string;
    readonly authorName: string;
    /** which of the author's agents wrote it (Claude Code, Codex …) */
    readonly agent?: string;
    readonly decisions: ReadonlyArray<Decision>;
    readonly forks: ReadonlyArray<Fork>;
    /** present when the why was inferred, not told */
    readonly assumed?: Assumed;
    /** present once the code's author took it over: whose AI guessed it */
    readonly claimed?: { readonly guessedBy: string; readonly guessedByName: string; readonly at: number };
    /** how the change works, drawn and played, when its author drew it */
    readonly machine?: Machine;
    /** where the change can be seen running */
    readonly shows?: ReadonlyArray<Show>;
    readonly ts: number;
  };
  readonly links: ReadonlyArray<{ readonly label: string; readonly url: string }>;
  /** the stack as the room's own reviews make it, before the host is asked:
   *  so the row stands from the first paint, the host adding its pull requests */
  readonly stack?: Stack | null;
}

export interface ReviewPageData extends ReviewPageHead {
  /** where the diff came from, in words for the page */
  readonly source: { readonly kind: "clone" | "host" | "none"; readonly detail: string };
  /** the branch's commit the diff was read at, when it came from a clone —
   *  what a file marked as viewed remembers, to show what moved since */
  readonly commit?: string;
  readonly grouped: Grouped | null;
}

/** wholeFile(ticketId, file) — the whole file as the review's
 *  branch has it, from the reader's clone, line by line; or why not. */
export type WholeFileResult = { readonly lines: ReadonlyArray<string> } | { readonly error: string };

/** sinceViewed(ticketId, file, from) — what changed in one file from
 *  the commit the reader viewed it at to the branch now, as hunks; or why
 *  not (the branch was rewritten and that commit is gone, say). */
export type SinceResult = { readonly hunks: ReadonlyArray<Hunk> } | { readonly error: string };

/** While a server is still reading the project, what it answers is
 *  `partial` — perhaps missing what it has not read yet — with how much it
 *  has read (`progress`, 0–100) when it says. */
export interface Reading {
  readonly partial?: true;
  readonly progress?: number;
}

/** hoverAt(ticketId, file, line, col) — what the type checker says
 *  about the symbol there: markdown (a code fence with the signature, then
 *  its doc comment), nothing, or why it could not answer. */
export type HoverResult =
  | ({ readonly markdown: string } & Reading)
  | ({ readonly none: true } & Reading)
  | { readonly missing: true }
  | { readonly error: string };

/** One declaration a symbol resolves to. `code` is the declaration itself (a
 *  function with its body), from `line`, cut at a length with `more` lines
 *  left; null where there is no file to read (TypeScript's own library). */
export interface Peek {
  readonly file: string;
  /** in the branch, in a dependency (node_modules, vendor), or part of the
   *  language itself — then `builtInto` names it */
  readonly where: "branch" | "package" | "builtin";
  readonly builtInto?: string;
  readonly line: number;
  /** the doc comment above it, as text (markers stripped), whole or null */
  readonly doc: string | null;
  readonly code: string | null;
  readonly more: number;
}

/** definitionAt(ticketId, file, line, col) */
export type DefinitionResult = ({ readonly peeks: ReadonlyArray<Peek> } & Reading) | { readonly missing: true } | { readonly error: string };

/** The server was still reading the project when it answered: what it said
 *  may be incomplete. Said on the page, never shown as if it were the whole
 *  answer, and asked again by the page until it is. */
export const stillReading = (answer: HoverResult | DefinitionResult): boolean => "partial" in answer && answer.partial === true;

/** How far it had read, when it said — for "reading the project · 40%". */
export const readSoFar = (answer: HoverResult | DefinitionResult): number | null => ("progress" in answer && typeof answer.progress === "number" ? answer.progress : null);

/** An answer that may change if asked again — partial, or a failure — is
 *  not one to keep. */
export const final = (answer: HoverResult | DefinitionResult): boolean => !("error" in answer) && !("missing" in answer) && !stillReading(answer);

/** The languages the review page can ask a language server about, each
 *  answered by a tool collagen installs on the reader's click. */
export type ToolId = "typescript" | "php";

/** Which tool answers for a file, by its extension — one table, read by the
 *  instance (which files it may be asked about) and the page (which words
 *  answer to the pointer, which offer to show). */
const TOOL_OF_EXTENSION: Readonly<Record<string, ToolId>> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "typescript", jsx: "typescript", mjs: "typescript", cjs: "typescript",
  php: "php", phtml: "php",
};
export const toolOf = (file: string): ToolId | null => TOOL_OF_EXTENSION[file.split(".").pop()?.toLowerCase() ?? ""] ?? null;
export const toolIds = (): ReadonlyArray<ToolId> => [...new Set(Object.values(TOOL_OF_EXTENSION))];

/** toolState(tool) — a pinned language server the hints need: not
 *  installed yet, being installed, or ready; installTool(tool), on the
 *  reader's click, installs it. What the offer says comes with it: the
 *  language, the tool's name, its size, and its licence where that is not
 *  open source.
 *  `notices` are messages the server itself asked to show the person. */
export interface ToolState {
  readonly tool: ToolId;
  /** the language it answers for ("PHP") and the tool itself ("Intelephense") */
  readonly language: string;
  readonly name: string;
  readonly state: "missing" | "installing" | "ready";
  readonly version: string;
  readonly size: string;
  readonly licence?: { readonly name: string; readonly url: string };
  readonly notices?: ReadonlyArray<string>;
  readonly error?: string;
}

/** Someone on the repository's host (GitHub): the person signed in through
 *  their own `gh`, or a comment's author. */
export interface HostUser {
  readonly login: string;
  readonly name?: string;
  readonly avatarUrl?: string;
}

/** The pull request a review's branch is, on its host. `mine`: the person
 *  signed in opened it — a host does not let you approve your own. */
export interface PullRequest {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly state: "open" | "closed" | "merged";
  readonly draft: boolean;
  readonly author: string;
  /** the commit its head is at on the host */
  readonly head: string;
  /** "approved", "changes requested", "review required" — the host's word, when it has one */
  readonly decision?: string;
  readonly mine: boolean;
}

/** A side of the pull request's diff: the new file's lines (RIGHT), or the
 *  removed lines of the old one (LEFT). */
export type DiffSide = "LEFT" | "RIGHT";

/** On lines of a file: the (last) `line` on `side`; a block runs from
 *  `startLine` on `startSide` and sits under its last line, as on GitHub.
 *  `subject` is never written for these (no comment before file comments had
 *  one); it is here to tell the two apart. */
export interface OnLines {
  readonly subject?: "line";
  readonly file: string;
  readonly line: number;
  readonly side: DiffSide;
  readonly startLine?: number;
  readonly startSide?: DiffSide;
}

/** On the file itself, with no line — its place, its name, that it should
 *  not be there — shown at the top of the file (GitHub's file comment). */
export interface OnFile {
  readonly subject: "file";
  readonly file: string;
}

/** Where a comment sits on the review's code: on lines, or on a whole file. */
export type CommentSpot = OnLines | OnFile;

/** A comment on the pull request's code: on a line, a block of lines, or a
 *  whole file (`CommentSpot`). */
export type LineComment = CommentSpot & {
  /** the host's id for it, or collagen's own for one said only in the room */
  readonly id: string;
  readonly author: HostUser;
  readonly body: string;
  readonly url: string;
  readonly at: string;
  /** shown before the host has answered: the reader's own, on its way */
  readonly pending?: true;
  /** drafted by the reader's AI, accepted by the reader */
  readonly drafted?: true;
  /** the AI's longer version, one step away from the words shown */
  readonly detail?: string;
  /** a reply: the id of the comment it answers, in the same thread */
  readonly replyTo?: string;
};

/** A review on the pull request as its host has it: who, their verdict, and
 *  what they wrote on the whole (their line comments are LineComments). */
export interface HostReview {
  readonly id: string;
  readonly author: HostUser;
  readonly verdict: "approved" | "changes requested" | "commented" | "dismissed";
  readonly body: string;
  readonly at: string;
  readonly url: string;
  /** the commit it was given at, when the host says */
  readonly commit?: string;
}

/** A comment in the pull request's conversation — on the whole, not a line —
 *  or a line comment GitHub no longer places on a line (`outdated`: where it
 *  was, as words). */
export interface HostNote {
  readonly id: string;
  readonly author: HostUser;
  readonly body: string;
  readonly at: string;
  readonly url: string;
  readonly outdated?: string;
}

/** A comment not said yet: drafted by the reader's AI and waiting on them,
 *  or pending in their review — said with the rest when they finish it. */
export type DraftView = CommentSpot & {
  readonly id: string;
  /** the commit it was written at — its lines are that commit's */
  readonly commit: string;
  readonly body: string;
  /** the AI's longer version, one step away from the words shown */
  readonly detail?: string;
  /** pending: accepted from the reader's AI */
  readonly drafted?: true;
  /** pending: on the pull request already — a finish that stopped before the
   *  room had it; finishing again tells the room */
  readonly posted?: true;
};

/** talkView(ticketId) — the comments on the review's code that collagen
 *  holds: what the reader's AI drafted and what is pending in the reader's
 *  review (both this machine's only), and what has been said in the room —
 *  each with the host's id when it is on the pull request too, so the page
 *  shows it once. */
export interface TalkView {
  readonly drafts: ReadonlyArray<DraftView>;
  readonly pending: ReadonlyArray<DraftView>;
  readonly said: ReadonlyArray<LineComment & { readonly hostId?: string }>;
}

/** What changing drafts or pending comments did: how many, and each one that could not be, with why. */
export interface DraftsResult {
  readonly done: number;
  readonly failed: ReadonlyArray<{ readonly id: string; readonly error: string }>;
}

/** A review finished: its pending comments said — in the room, and with the
 *  verdict on the pull request when there is one — or why not (all of it
 *  stays pending then). */
/** A finish of the reader's review from the page: its own id (the same when
 *  it is sent again) and the ids of the pending comments the page showed. */
export interface Finish {
  readonly id: string;
  readonly pending: ReadonlyArray<string>;
}

export type SubmitResult =
  | {
      readonly ok: true;
      readonly said: number;
      /** the review on the host */
      readonly url?: string;
      /** said in the room only — why not on the host too (no pull request, say) */
      readonly roomOnly?: string;
      /** this finish was done already: nothing said again */
      readonly already?: true;
      /** a must comment in it made the review request changes */
      readonly changesRequested?: true;
    }
  | {
      readonly error: string;
      /** the review reached the host, its words and verdict with it — only the
       *  room is still to be told: a new finish is a new review */
      readonly onHost?: true;
      /** nothing was submitted: these pending comments were written on
       *  another commit, each to keep where it sits now or delete first */
      readonly held?: ReadonlyArray<string>;
    };

/** One branch of a stack: a pull request, a review in the room, or the
 *  trunk everything builds on. */
export interface StackStep {
  readonly branch: string;
  readonly label: string;
  readonly url?: string;
  readonly number?: number;
  readonly kind: "pull" | "review" | "trunk";
}

/** The stack a review's branch sits in: what it builds on, from the trunk
 *  up, and what builds on it. */
export interface Stack {
  readonly below: ReadonlyArray<StackStep>;
  readonly here: StackStep;
  /** the chain on top of it, while there is one way up */
  readonly above: ReadonlyArray<StackStep>;
  /** where several branches build on the top of that chain: each of them */
  readonly split: ReadonlyArray<StackStep>;
}

/** hostView(ticketId) — the review on its host: who is signed in, its pull
 *  request and that request's line comments, the stack; or why there is no
 *  host (no link, none collagen knows) — the stack the room's own reviews
 *  make still comes with it. Each part says why it is missing. */
export type HostView =
  | {
      readonly host: string;
      readonly viewer: HostUser | null;
      /** not signed in, or gh is not there: how to fix it */
      readonly signIn?: string;
      readonly pull: PullRequest | null;
      /** why there is no pull request, in words */
      readonly noPull?: string;
      readonly comments: ReadonlyArray<LineComment>;
      /** the reviews on the pull request, its conversation, and line comments
       *  on code that has changed since — oldest first */
      readonly reviews: ReadonlyArray<HostReview>;
      readonly conversation: ReadonlyArray<HostNote>;
      /** when the host was asked, ISO */
      readonly checkedAt: string;
      readonly stack: Stack | null;
    }
  | { readonly none: string; readonly stack: Stack | null };

/** What a review sends: a comment, an approval, or a request for changes. */
export type Verdict = "comment" | "approve" | "request-changes";

/** What the host said to a write: done (the comment as it now stands), or
 *  its refusal in words. */
/** Whose approval collagen waits for before it merges a review's pull request for its author. */
export type MergeFor = "off" | "theirs" | "mine" | "both";

/** mergeView(ticketId) — merging for a review the reader filed: its own
 *  setting (null: its room's applies), its room's, and the one in effect. */
export interface MergeView {
  readonly own: MergeFor | null;
  readonly room: MergeFor;
  readonly effect: MergeFor;
}

export type HostWrite = { readonly ok: true; readonly comment?: LineComment } | { readonly error: string };

/** What a review the reader filed grew from, still open and theirs, and
 *  whether their setting has it ticked to close with the review. */
export interface Parents {
  readonly tickets: ReadonlyArray<TicketRef>;
  readonly ticked: boolean;
}

/** A ticket named by id, with its headline and its kind. */
export interface TicketRef {
  readonly id: string;
  readonly title: string;
  readonly kind: MergeTicket["kind"];
}

/** A ticket a merge came from, or one that grew into it, as the merge
 *  history names it — one the reader may see. */
export interface MergeTicket {
  readonly id: string;
  readonly name: string;
  /** "you" for the reader's own */
  readonly author: string;
  readonly mine: boolean;
  readonly closed: boolean;
  readonly kind: "task" | "review" | "plan" | "proposal" | "bug" | "investigation" | "epic";
  /** what was decided on it, and why — on someone else's plan, proposal or
   *  bug, not before the reader's own take */
  readonly decisions: ReadonlyArray<MergeDecision>;
}

/** A decision on a ticket a merge came from: what, and the why behind it. */
export interface MergeDecision {
  readonly title: string;
  readonly what: string;
  /** what the person asked for, in their words */
  readonly userWhy?: string;
  /** the agent's reason for the shape it took */
  readonly agentWhy?: string;
}

/** One merge into a project's default branch, with the tickets it came from — none, often. */
export interface MergeEntry {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly branch: string;
  /** when it was merged, ISO */
  readonly at: string;
  /** the epics the tickets it grew from are in */
  readonly epics: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly tickets: ReadonlyArray<MergeTicket>;
}

/** A project's merges, the latest first — or why they cannot be read. */
export type ProjectHistory = { readonly project: string } & (
  | { readonly base: string; readonly merges: ReadonlyArray<MergeEntry>; /** more past these */ readonly more: boolean }
  | { readonly none: string }
);

/** mergeHistory(roomId, project, shown, fresh) — what was merged into one
 *  of a room's projects here, as the TUI's merges tab has it: the host's
 *  merges and the room's tickets, read together. */
export interface MergeHistory {
  readonly room: string;
  /** the room's projects held here, in the reader's order: the page's tabs */
  readonly projects: ReadonlyArray<string>;
  readonly history: ProjectHistory;
  /** when it was read, ISO */
  readonly readAt: string;
}

/** mergeProjects(roomId) — a room's projects held here, in the reader's
 *  order: where its merges address sends them (the first, unless a link
 *  names one). */
export interface MergeProjects {
  readonly room: string;
  readonly projects: ReadonlyArray<string>;
}

/** A finding as the investigation page draws it: the kind the run picked. */
export type AnswerBlockView =
  | { readonly kind: "verdict"; readonly verdict: "yes" | "no" | "partly"; readonly text: string }
  | { readonly kind: "points"; readonly items: ReadonlyArray<string> }
  | { readonly kind: "facts"; readonly rows: ReadonlyArray<{ readonly label: string; readonly value: string }> }
  | { readonly kind: "compare"; readonly left: string; readonly right: string; readonly rows: ReadonlyArray<{ readonly what: string; readonly left: boolean; readonly right: boolean }> }
  | { readonly kind: "ranking"; readonly options: ReadonlyArray<{ readonly name: string; readonly fit: "best" | "good" | "partial" | "poor"; readonly why?: string }> }
  | { readonly kind: "choices"; readonly options: ReadonlyArray<{ readonly name: string; readonly call: "adopt" | "maybe" | "skip"; readonly why?: string }> };

/** How an answer ended, when it is not simply answered. */
export type AnswerOutcome = "answered" | "not-answerable" | "wrong-question";

/** A follow-up written on a goal whose 'if' held, and what looking into it found. */
export interface FollowUpView {
  readonly if: string;
  readonly title: string;
  readonly outcome: AnswerOutcome;
  readonly blocks: ReadonlyArray<AnswerBlockView>;
  /** everything found, when it says more than the blocks */
  readonly more?: string;
}

/** One person's answer to a goal. */
export interface AnswerView {
  /** who answered it, by name */
  readonly by: string;
  readonly outcome: AnswerOutcome;
  readonly blocks: ReadonlyArray<AnswerBlockView>;
  /** everything found, when it says more than the blocks (an answer from
   *  before blocks has its findings here and none above) */
  readonly more?: string;
  readonly sources: ReadonlyArray<string>;
  readonly followUps: ReadonlyArray<FollowUpView>;
}

export interface GoalView {
  readonly id: string;
  /** a few words; the ask beneath */
  readonly title: string;
  /** the question as it was asked; absent when the title is all there is */
  readonly ask?: string;
  readonly answers: ReadonlyArray<AnswerView>;
}

/** investigationPage(ticketId) — an investigation as its page reads it. */
export interface InvestigationPage {
  readonly id: string;
  readonly title: string;
  readonly question: string;
  readonly open: boolean;
  readonly openedBy: string;
  /** goals with an answer, of all */
  readonly done: number;
  readonly total: number;
  /** who has answered, by name */
  readonly people: ReadonlyArray<string>;
  /** each model that answered, and in how many runs */
  readonly models: ReadonlyArray<{ readonly name: string; readonly runs: number }>;
  /** its goals in their groups, in goal order; a goal in no group stands under none */
  readonly groups: ReadonlyArray<{ readonly name: string | null; readonly goals: ReadonlyArray<GoalView> }>;
  /** what only the reader can decide, from every answer */
  readonly questions: ReadonlyArray<{ readonly by: string; readonly text: string }>;
}
