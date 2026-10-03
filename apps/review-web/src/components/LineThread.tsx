import { createSignal, For, Show } from "solid-js";
import type { LineComment } from "../data";
import { hostNow } from "../hostNow";

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

/** One comment on a line: who, when, what — its words as written, never as
 *  HTML. The reader's own, on its way, is marked so. */
function Comment(props: { comment: LineComment }) {
  return (
    <div class={["line-comment", { pending: props.comment.pending }]}>
      <div class="line-comment-head">
        <Show when={props.comment.author.avatarUrl}>{(src) => <img class="avatar" src={src()} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} width={18} height={18} />}</Show>
        <strong>{props.comment.author.login}</strong>
        <span class="line-comment-when">{props.comment.pending ? "sending…" : when(props.comment.at)}</span>
        <Show when={props.comment.url}>
          {(url) => (
            <a class="line-comment-link" href={url()} target="_blank" rel="noreferrer">
              on GitHub
            </a>
          )}
        </Show>
      </div>
      <p class="line-comment-body">{props.comment.body}</p>
    </div>
  );
}

/** The comments on one line of a hunk and, when the reader opened it, a box
 *  to add theirs. Posting shows the comment at once; the box stays with its
 *  words until GitHub has it, and says why if it refused. */
export function LineThread(props: { file: string; side: "LEFT" | "RIGHT"; line: number }) {
  const [body, setBody] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [said, setSaid] = createSignal<string | null>(null);
  const here = () => hostNow.commentsAt(props.file, props.side, props.line);
  const open = () => hostNow.composing(props.file, props.side, props.line);
  const close = () => hostNow.compose(props.file, props.side, null);
  const send = async () => {
    const text = body().trim();
    if (text.length === 0 || sending()) return;
    setSending(true);
    setSaid(null);
    try {
      const r = await hostNow.comment(props.file, props.side, props.line, text);
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
    <Show when={here().length > 0 || open()}>
      <tr class="thread-row">
        <td colspan={3}>
          <div class="thread">
            <For each={here()}>{(c) => <Comment comment={c} />}</For>
            <Show when={open()}>
              <form
                class="line-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <textarea
                  ref={(el) => requestAnimationFrame(() => el.focus())}
                  rows={3}
                  placeholder={`Comment on line ${props.line}`}
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
            </Show>
          </div>
        </td>
      </tr>
    </Show>
  );
}
