import { createSignal, For, Show } from "solid-js";
import type { DraftView, LineComment } from "~/data";
import { enter } from "~/fold";
import { hostNow } from "~/hostNow";
import { bodyParts, suggestionBlock } from "~/suggest";
import { Markdown } from "~/components/Markdown";
import { StrengthMark, StrengthPicker } from "~/components/Strength";
import { readStrength, withStrength, type Strength } from "~/strength";

/** When a comment was written, as a reader says it. */
const when = (iso: string): string => {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const mins = Math.round((Date.now() - time) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(time).toLocaleDateString();
};

/** A place on the diff as GitHub names it: +12 on the new side, −12 on the old. */
const named = (side: "LEFT" | "RIGHT", line: number) => `${side === "LEFT" ? "−" : "+"}${line}`;

/** Which lines a comment is on, in words: "line +12", "lines +12 to +15". */
const linesOf = (comment: { readonly line: number; readonly side: "LEFT" | "RIGHT"; readonly startLine?: number; readonly startSide?: "LEFT" | "RIGHT" }) =>
  comment.startLine !== undefined ? `lines ${named(comment.startSide ?? comment.side, comment.startLine)} to ${named(comment.side, comment.line)}` : `line ${named(comment.side, comment.line)}`;

/** The code a suggestion would replace: the new file's lines it is on, when
 *  the hunk shows them (a suggestion only ever replaces new-side lines). */
export type CodeOf = (from: number, to: number) => ReadonlyArray<string> | null;

/** A suggested change in a comment: the lines it replaces, struck, and what
 *  it suggests in their place — with its code to copy, to apply it by hand. */
function Suggestion(props: { code: string; replaces: ReadonlyArray<string> | null }) {
  const [copied, setCopied] = createSignal(false);
  const copy = () =>
    void navigator.clipboard.writeText(props.code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  const suggested = () => (props.code.length === 0 ? [] : props.code.split("\n"));
  return (
    <div class="suggestion">
      <div class="suggestion-head">
        <span>Suggested change</span>
        <button type="button" class="quiet small" onClick={copy} title="Copy the suggested code">
          {copied() ? "Copied" : "Copy"}
        </button>
      </div>
      <pre class="suggestion-code">
        <For each={props.replaces ?? []}>{(line) => <div class="sg-del">- {line}</div>}</For>
        <For each={suggested()}>{(line) => <div class="sg-add">+ {line}</div>}</For>
        <Show when={suggested().length === 0}>
          <div class="sg-none">(remove these lines)</div>
        </Show>
      </pre>
    </div>
  );
}

/** One comment: who, when, which lines, what — its words as markdown, never
 *  as HTML; a suggested change in it shown as one. The reader's own, on its
 *  way, is marked so. */
function Comment(props: { comment: LineComment; codeOf: CodeOf }) {
  const words = () => readStrength(props.comment.body);
  const replaces = () => {
    const comment = props.comment;
    return comment.side === "RIGHT" && (comment.startSide ?? "RIGHT") === "RIGHT" ? props.codeOf(comment.startLine ?? comment.line, comment.line) : null;
  };
  return (
    <div class={["line-comment", { pending: props.comment.pending, reply: props.comment.replyTo !== undefined }]}>
      <div class="line-comment-head">
        <Show when={props.comment.author.avatarUrl}>{(src) => <img class="avatar" src={src()} alt="" onError={(event) => (event.currentTarget.style.visibility = "hidden")} width={18} height={18} />}</Show>
        <strong>{props.comment.author.login}</strong>
        <StrengthMark strength={words().strength} />
        <Show when={props.comment.drafted}>
          <span class="drafted-mark" title="Drafted by their AI, accepted by them">with AI</span>
        </Show>
        <span class="line-comment-when">
          {props.comment.startLine !== undefined ? `on ${linesOf(props.comment)} · ` : ""}
          {props.comment.pending ? "sending…" : when(props.comment.at)}
        </span>
        <Show when={props.comment.url}>
          {(url) => (
            <a class="line-comment-link" href={url()} target="_blank" rel="noreferrer">
              on {hostNow.hostName()}
            </a>
          )}
        </Show>
      </div>
      <For each={bodyParts(words().text)}>
        {(part) => (part.kind === "text" ? <Markdown text={part.text} /> : <Suggestion code={part.code} replaces={replaces()} />)}
      </For>
    </div>
  );
}

/** A comment the reader's AI drafted, waiting on the reader: its words (a
 *  suggestion in them shown as one), and Add to review — pending in their
 *  review, said when they finish it — Edit, or Decline. */
/** A comment not said yet, written at another commit than the one the page
 *  shows: where it sits may have moved. The reader confirms it here or
 *  deletes it — until then, finishing the review refuses it. */
function Moved(props: { comment: DraftView }) {
  return (
    <Show when={hostNow.moved(props.comment)}>
      <p class="moved-note">
        Written at {props.comment.commit.slice(0, 7)} — the code has moved since, so these lines may not be the ones it meant.
        <button type="button" class="link" onClick={() => void hostNow.repin(props.comment.id)} title="It is about these lines at the commit shown now">
          Keep it here
        </button>
      </p>
    </Show>
  );
}

function Draft(props: { draft: DraftView; codeOf: CodeOf }) {
  const words = () => readStrength(props.draft.body);
  const [editing, setEditing] = createSignal(false);
  const [body, setBody] = createSignal(words().text);
  const [strength, setStrength] = createSignal<Strength | null>(words().strength);
  const [busy, setBusy] = createSignal(false);
  const edited = () => withStrength(strength(), body().trim());
  const replaces = () => {
    const draft = props.draft;
    return draft.side === "RIGHT" && (draft.startSide ?? "RIGHT") === "RIGHT" ? props.codeOf(draft.startLine ?? draft.line, draft.line) : null;
  };
  const accept = async () => {
    setBusy(true);
    try {
      await hostNow.accept([props.draft.id], editing() && edited() !== props.draft.body ? { [props.draft.id]: edited() } : {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="line-comment draft" id={`draft-${props.draft.id}`}>
      <div class="line-comment-head">
        <span class="draft-badge">Draft from your AI</span>
        <Show when={!editing()}>
          <StrengthMark strength={words().strength} />
        </Show>
        <span class="line-comment-when">on {linesOf(props.draft)}</span>
      </div>
      <Show
        when={editing()}
        fallback={<For each={bodyParts(words().text)}>{(part) => (part.kind === "text" ? <Markdown text={part.text} /> : <Suggestion code={part.code} replaces={replaces()} />)}</For>}
      >
        <textarea class="draft-edit" rows={Math.min(14, Math.max(3, body().split("\n").length + 1))} value={body()} onInput={(event) => setBody(event.currentTarget.value)} />
        <StrengthPicker value={strength()} onChange={setStrength} />
      </Show>
      <Moved comment={props.draft} />
      <Show when={hostNow.refusal(props.draft.id)}>{(why) => <p class="host-error">Not posted: {why()}</p>}</Show>
      <div class="composer-actions">
        <button type="button" class="quiet" disabled={busy()} onClick={() => void hostNow.decline([props.draft.id])}>
          Decline
        </button>
        <button type="button" class="quiet" disabled={busy()} onClick={() => setEditing(!editing())}>
          {editing() ? "Done editing" : "Edit"}
        </button>
        <button type="button" class="banner-go" disabled={busy() || body().trim().length === 0} onClick={() => void accept()} title="Put it in your review — said with the rest when you finish it">
          {busy() ? "Adding…" : "Add to review"}
        </button>
      </div>
    </div>
  );
}

/** A comment pending in the reader's review: theirs (or their AI's, taken
 *  in), said with the rest when they finish it — to edit or delete till then. */
function Pending(props: { comment: DraftView; codeOf: CodeOf }) {
  const words = () => readStrength(props.comment.body);
  const [editing, setEditing] = createSignal(false);
  const [body, setBody] = createSignal(words().text);
  const [strength, setStrength] = createSignal<Strength | null>(words().strength);
  const replaces = () => {
    const comment = props.comment;
    return comment.side === "RIGHT" && (comment.startSide ?? "RIGHT") === "RIGHT" ? props.codeOf(comment.startLine ?? comment.line, comment.line) : null;
  };
  const save = () => {
    const text = withStrength(strength(), body().trim());
    if (body().trim().length > 0 && text !== props.comment.body) void hostNow.edit(props.comment.id, text);
    setEditing(false);
  };
  return (
    <div class="line-comment pending-review">
      <div class="line-comment-head">
        <span class="pending-badge">{props.comment.posted ? `On ${hostNow.hostName()}` : "Pending"}</span>
        <Show when={!editing()}>
          <StrengthMark strength={words().strength} />
        </Show>
        <Show when={props.comment.drafted}>
          <span class="drafted-mark" title="Drafted by your AI, taken into your review">with AI</span>
        </Show>
        <span class="line-comment-when">on {linesOf(props.comment)}</span>
      </div>
      <Show
        when={editing()}
        fallback={<For each={bodyParts(words().text)}>{(part) => (part.kind === "text" ? <Markdown text={part.text} /> : <Suggestion code={part.code} replaces={replaces()} />)}</For>}
      >
        <textarea class="draft-edit" rows={Math.min(14, Math.max(3, body().split("\n").length + 1))} value={body()} onInput={(event) => setBody(event.currentTarget.value)} />
        <StrengthPicker value={strength()} onChange={setStrength} />
      </Show>
      <Show when={!props.comment.posted} fallback={<p class="moved-note">On the pull request already — finish the review again to say it in the room.</p>}>
        <Moved comment={props.comment} />
      </Show>
      <Show when={hostNow.refusal(props.comment.id)}>{(why) => <p class="host-error">{why()}</p>}</Show>
      <Show when={!props.comment.posted}>
      <div class="composer-actions">
        <button type="button" class="quiet" onClick={() => void hostNow.unpend([props.comment.id])}>
          Delete
        </button>
        <Show when={editing()} fallback={<button type="button" class="quiet" onClick={() => setEditing(true)}>Edit</button>}>
          <button type="button" class="quiet" onClick={() => (setBody(words().text), setStrength(words().strength), setEditing(false))}>
            Cancel
          </button>
          <button type="button" class="banner-go" onClick={save}>
            Save
          </button>
        </Show>
      </div>
      </Show>
    </div>
  );
}

/** The comments on one line of a hunk, the ones pending in the reader's
 *  review, and the drafts their AI left there — a block of lines' sit under
 *  its last line, as on GitHub. */
export function LineThread(props: { file: string; side: "LEFT" | "RIGHT"; line: number; codeOf: CodeOf }) {
  const here = () => hostNow.commentsAt(props.file, props.side, props.line);
  const inReview = () => hostNow.pendingAt(props.file, props.side, props.line);
  const drafted = () => hostNow.draftsAt(props.file, props.side, props.line);
  return (
    <Show when={here().length > 0 || inReview().length > 0 || drafted().length > 0}>
      <tr class="thread-row">
        <td colspan={3}>
          {/* a thread comes with the host's answer, or with a comment written: it opens into place */}
          <div
            class="thread"
            ref={enter}
          >
            <For each={here()}>{(comment) => <Comment comment={comment} codeOf={props.codeOf} />}</For>
            <For each={inReview()}>{(pending) => <Pending comment={pending} codeOf={props.codeOf} />}</For>
            <For each={drafted()}>{(draft) => <Draft draft={draft} codeOf={props.codeOf} />}</For>
          </div>
        </td>
      </tr>
    </Show>
  );
}

/** A comment being written on the lines picked: one line, or a block from
 *  `from` to `to`. "Suggest a change" puts the picked lines in a suggestion
 *  block to edit (only new-side lines can be suggested over, as on GitHub).
 *  Posting shows the comment at once; the box keeps its words until GitHub
 *  has it, and says why if it refused. */
export function LineComposer(props: {
  file: string;
  from: { readonly side: "LEFT" | "RIGHT"; readonly line: number };
  to: { readonly side: "LEFT" | "RIGHT"; readonly line: number };
  /** the picked lines' code, when every one is on the new side */
  suggestable: ReadonlyArray<string> | null;
}) {
  const [body, setBody] = createSignal("");
  const [strength, setStrength] = createSignal<Strength | null>(null);
  const [sending, setSending] = createSignal(false);
  const [said, setSaid] = createSignal<string | null>(null);
  let box: HTMLTextAreaElement | undefined;
  const block = () => props.from.line !== props.to.line || props.from.side !== props.to.side;
  const close = () => hostNow.clearPick();
  const suggest = () => {
    if (!box || !props.suggestable) return;
    const at = box.selectionStart ?? body().length;
    const before = body().slice(0, at);
    const insert = `${before.length > 0 && !before.endsWith("\n") ? "\n" : ""}${suggestionBlock(props.suggestable)}\n`;
    setBody(before + insert + body().slice(at));
    requestAnimationFrame(() => {
      box!.focus();
      box!.setSelectionRange(at + insert.length, at + insert.length);
    });
  };
  /** into the review (pending, as GitHub's "Start a review") or, single, said at once */
  const send = async (single: boolean) => {
    if (body().trim().length === 0 || sending()) return;
    const text = withStrength(strength(), body().trim());
    setSending(true);
    setSaid(null);
    try {
      const start = block() ? props.from : null;
      const result = single ? await hostNow.comment(props.file, props.to.side, props.to.line, text, start) : await hostNow.addToReview(props.file, props.to.side, props.to.line, text, start);
      if ("error" in result) return setSaid(result.error);
      setBody("");
      close();
    } catch (error) {
      setSaid(String(error));
    } finally {
      setSending(false);
    }
  };
  return (
    <tr class="thread-row">
      <td colspan={3}>
        <div class="thread">
          <form
            class="line-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send(false);
            }}
          >
            <div class="composer-head">
              <span>Comment on {linesOf({ ...props.to, startLine: block() ? props.from.line : undefined, startSide: props.from.side })}</span>
              <Show when={props.suggestable}>
                <button type="button" class="quiet small" onClick={suggest} title="Put these lines in a suggestion to edit — the author can take it as it is">
                  ± Suggest a change
                </button>
              </Show>
            </div>
            <textarea
              ref={(element) => {
                box = element;
                requestAnimationFrame(() => element.focus());
              }}
              rows={4}
              placeholder="Leave a comment"
              value={body()}
              onInput={(event) => setBody(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send(false);
                if (event.key === "Escape") close();
              }}
            />
            <StrengthPicker value={strength()} onChange={setStrength} />
            <Show when={said()}>{(why) => <p class="host-error">{why()}</p>}</Show>
            <div class="composer-actions">
              <button type="button" class="quiet" onClick={close}>
                Cancel
              </button>
              <button type="button" class="quiet" disabled={sending() || body().trim().length === 0} onClick={() => void send(true)} title="Say it now, on its own — not as part of your review">
                Add single comment
              </button>
              <button type="submit" class="banner-go" disabled={sending() || body().trim().length === 0} title="Keep it in your review, said with the rest when you finish it">
                {sending() ? "Adding…" : hostNow.pending().length > 0 ? "Add review comment" : "Start a review"}
              </button>
            </div>
          </form>
        </div>
      </td>
    </tr>
  );
}
