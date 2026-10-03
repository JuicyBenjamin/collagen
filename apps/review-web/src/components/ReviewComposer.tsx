import { createSignal, Show } from "solid-js";
import type { Verdict } from "../data";
import { hostNow } from "../hostNow";

const VERDICTS: ReadonlyArray<{ readonly value: Verdict; readonly label: string; readonly hint: string }> = [
  { value: "comment", label: "Comment", hint: "Say something without a verdict" },
  { value: "approve", label: "Approve", hint: "It can be merged" },
  { value: "request-changes", label: "Request changes", hint: "It needs changes before it is merged" },
];

/** A review of the pull request, as GitHub's "Review changes" has it: words,
 *  and one of comment, approve or request changes — sent in the reader's
 *  name through their own gh. Your own pull request takes comments only.
 *  This reviews the pull request on GitHub; your take on the collagen ticket
 *  still goes through your agent. */
export function ReviewComposer(props: { mine: boolean; onDone: () => void }) {
  const [body, setBody] = createSignal("");
  const [verdict, setVerdict] = createSignal<Verdict>("comment");
  const [sending, setSending] = createSignal(false);
  const [said, setSaid] = createSignal<string | null>(null);
  const send = async () => {
    setSending(true);
    setSaid(null);
    try {
      const r = await hostNow.review(verdict(), body());
      if ("error" in r) return setSaid(r.error);
      setBody("");
      props.onDone();
    } catch (e) {
      setSaid(String(e));
    } finally {
      setSending(false);
    }
  };
  return (
    <form
      class="review-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <textarea
        placeholder={verdict() === "approve" ? "Anything to add (optional)" : "What do you think?"}
        value={body()}
        onInput={(e) => setBody(e.currentTarget.value)}
        rows={4}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
        }}
      />
      <fieldset class="verdicts">
        {VERDICTS.map((v) => (
          <label class={{ disabled: props.mine && v.value !== "comment" }} title={props.mine && v.value !== "comment" ? "You opened this pull request: GitHub only lets you comment on your own" : v.hint}>
            <input type="radio" name="verdict" value={v.value} checked={verdict() === v.value} disabled={props.mine && v.value !== "comment"} onChange={() => setVerdict(v.value)} />
            {v.label}
          </label>
        ))}
      </fieldset>
      <Show when={said()}>{(why) => <p class="host-error">{why()}</p>}</Show>
      <div class="composer-actions">
        <button type="button" class="quiet" onClick={() => props.onDone()}>
          Cancel
        </button>
        <button type="submit" class="banner-go" disabled={sending() || (verdict() !== "approve" && body().trim().length === 0)}>
          {sending() ? "Sending…" : "Submit review"}
        </button>
      </div>
    </form>
  );
}
