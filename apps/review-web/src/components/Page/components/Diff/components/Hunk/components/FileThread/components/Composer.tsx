import { createSignal, Show } from "solid-js";
import { snapToTop } from "~/fold";
import { hostNow } from "~/hostNow";
import { StrengthPicker } from "~/components/Strength";
import { withStrength, type Strength } from "~/strength";

/** A comment being written on a file itself, with no line: into the
 *  reader's review, or said at once on its own. The box keeps its words
 *  until it is taken, and says why if it was refused. */
export function Composer(props: { file: string; onClose: () => void }) {
  const [body, setBody] = createSignal("");
  const [strength, setStrength] = createSignal<Strength | null>(null);
  const [sending, setSending] = createSignal(false);
  const [refused, setRefused] = createSignal<string | null>(null);
  const send = async (single: boolean) => {
    if (body().trim().length === 0 || sending()) return;
    const text = withStrength(strength(), body().trim());
    const spot = { subject: "file", file: props.file } as const;
    setSending(true);
    setRefused(null);
    try {
      const result = single ? await hostNow.comment(spot, text) : await hostNow.addToReview(spot, text);
      if ("error" in result) return setRefused(result.error);
      setBody("");
      props.onClose();
    } catch (error) {
      setRefused(String(error));
    } finally {
      setSending(false);
    }
  };
  return (
    <form
      class="line-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send(false);
      }}
    >
      <div class="composer-head">
        <span>Comment on the file</span>
      </div>
      <textarea
        class="textarea"
        // opened at the file's top: the page goes to the file, snapped to the window's top,
        // and focusing scrolls nothing more — the pointer is never left on the file above
        ref={(element) =>
          requestAnimationFrame(() => {
            snapToTop(element.closest(".hunk-group"));
            element.focus({ preventScroll: true });
          })
        }
        rows={3}
        placeholder="Leave a comment"
        value={body()}
        onInput={(event) => setBody(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send(false);
          if (event.key === "Escape") props.onClose();
        }}
      />
      <StrengthPicker value={strength()} onChange={setStrength} />
      <Show when={refused()}>{(why) => <p class="host-error">{why()}</p>}</Show>
      <div class="composer-actions">
        <button type="button" class="btn btn-sm" onClick={() => props.onClose()}>
          Cancel
        </button>
        <button type="button" class="btn btn-sm" disabled={sending() || body().trim().length === 0} onClick={() => void send(true)} title="Say it now, on its own — not as part of your review">
          Add single comment
        </button>
        <button type="submit" class="btn btn-primary btn-sm" disabled={sending() || body().trim().length === 0} title="Keep it in your review, said with the rest when you finish it">
          {sending() ? "Adding…" : hostNow.pending().length > 0 ? "Add review comment" : "Start a review"}
        </button>
      </div>
    </form>
  );
}
