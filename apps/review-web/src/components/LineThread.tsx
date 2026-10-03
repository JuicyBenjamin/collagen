import { createSignal, For, Show } from "solid-js";
import type { LineComment } from "../data";
import { hostNow } from "../hostNow";
import { bodyParts, suggestionBlock } from "../suggest";

/** When a comment was written, as a reader says it. */
const when = (iso: string): string => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(t).toLocaleDateString();
};

/** A place on the diff as GitHub names it: +12 on the new side, −12 on the old. */
const named = (side: "LEFT" | "RIGHT", line: number) => `${side === "LEFT" ? "−" : "+"}${line}`;

/** Which lines a comment is on, in words: "line +12", "lines +12 to +15". */
const linesOf = (c: { readonly line: number; readonly side: "LEFT" | "RIGHT"; readonly startLine?: number; readonly startSide?: "LEFT" | "RIGHT" }) =>
  c.startLine !== undefined ? `lines ${named(c.startSide ?? c.side, c.startLine)} to ${named(c.side, c.line)}` : `line ${named(c.side, c.line)}`;

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
        <For each={props.replaces ?? []}>{(l) => <div class="sg-del">- {l}</div>}</For>
        <For each={suggested()}>{(l) => <div class="sg-add">+ {l}</div>}</For>
        <Show when={suggested().length === 0}>
          <div class="sg-none">(remove these lines)</div>
        </Show>
      </pre>
    </div>
  );
}

/** One comment: who, when, which lines, what — its words as written, never
 *  as HTML; a suggested change in it shown as one. The reader's own, on its
 *  way, is marked so. */
function Comment(props: { comment: LineComment; codeOf: CodeOf }) {
  const replaces = () => {
    const c = props.comment;
    return c.side === "RIGHT" && (c.startSide ?? "RIGHT") === "RIGHT" ? props.codeOf(c.startLine ?? c.line, c.line) : null;
  };
  return (
    <div class={["line-comment", { pending: props.comment.pending }]}>
      <div class="line-comment-head">
        <Show when={props.comment.author.avatarUrl}>{(src) => <img class="avatar" src={src()} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} width={18} height={18} />}</Show>
        <strong>{props.comment.author.login}</strong>
        <span class="line-comment-when">
          {props.comment.startLine !== undefined ? `on ${linesOf(props.comment)} · ` : ""}
          {props.comment.pending ? "sending…" : when(props.comment.at)}
        </span>
        <Show when={props.comment.url}>
          {(url) => (
            <a class="line-comment-link" href={url()} target="_blank" rel="noreferrer">
              on GitHub
            </a>
          )}
        </Show>
      </div>
      <For each={bodyParts(props.comment.body)}>
        {(part) => (part.kind === "text" ? <p class="line-comment-body">{part.text}</p> : <Suggestion code={part.code} replaces={replaces()} />)}
      </For>
    </div>
  );
}

/** The comments on one line of a hunk — a block of lines' comments sit under
 *  its last line, as on GitHub. */
export function LineThread(props: { file: string; side: "LEFT" | "RIGHT"; line: number; codeOf: CodeOf }) {
  const here = () => hostNow.commentsAt(props.file, props.side, props.line);
  return (
    <Show when={here().length > 0}>
      <tr class="thread-row">
        <td colspan={3}>
          <div class="thread">
            <For each={here()}>{(c) => <Comment comment={c} codeOf={props.codeOf} />}</For>
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
  const send = async () => {
    const text = body().trim();
    if (text.length === 0 || sending()) return;
    setSending(true);
    setSaid(null);
    try {
      const r = await hostNow.comment(props.file, props.to.side, props.to.line, text, block() ? props.from : null);
      if ("error" in r) return setSaid(r.error);
      setBody("");
      close();
    } catch (e) {
      setSaid(String(e));
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
            onSubmit={(e) => {
              e.preventDefault();
              void send();
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
              ref={(el) => {
                box = el;
                requestAnimationFrame(() => el.focus());
              }}
              rows={4}
              placeholder="Leave a comment"
              value={body()}
              onInput={(e) => setBody(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
                if (e.key === "Escape") close();
              }}
            />
            <Show when={said()}>{(why) => <p class="host-error">{why()}</p>}</Show>
            <div class="composer-actions">
              <button type="button" class="quiet" onClick={close}>
                Cancel
              </button>
              <button type="submit" class="banner-go" disabled={sending() || body().trim().length === 0}>
                {sending() ? "Sending…" : "Comment"}
              </button>
            </div>
          </form>
        </div>
      </td>
    </tr>
  );
}
