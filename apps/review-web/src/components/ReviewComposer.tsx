import { createSignal, Show } from "solid-js";
import type { Verdict } from "../data";
import { hostNow } from "../hostNow";

const VERDICTS: ReadonlyArray<{ readonly value: Verdict; readonly label: string; readonly hint: string }> = [
  { value: "comment", label: "Comment", hint: "Feedback without a verdict" },
  { value: "approve", label: "Approve", hint: "It can be merged" },
  { value: "request-changes", label: "Request changes", hint: "It needs changes before it is merged" },
];

/** Finishing the reader's review, as GitHub's "Finish your review" has it:
 *  their words on the whole, a verdict, and every comment pending in the
 *  review, said at once — in the room, and on the pull request as one review
 *  through their own gh. On their own pull request — or with none — the
 *  pending comments are said in the room alone: no verdict, and no words on
 *  the whole, which would have nowhere to go. Their take on the collagen
 *  ticket itself still goes through their agent. */
export function ReviewComposer(props: { onDone: () => void }) {
  const [body, setBody] = createSignal("");
  const [verdict, setVerdict] = createSignal<Verdict>("comment");
  const [sending, setSending] = createSignal(false);
  const [said, setSaid] = createSignal<string | null>(null);
  const count = () => hostNow.pending().length;
  const pull = () => hostNow.host()?.pull ?? null;
  const onHost = () => hostNow.canWrite();
  const ready = () => !sending() && (!onHost() ? count() > 0 : verdict() === "approve" || (verdict() === "request-changes" ? body().trim().length > 0 : body().trim().length > 0 || count() > 0));
  const send = async () => {
    if (!ready()) return;
    setSending(true);
    setSaid(null);
    try {
      // in the room alone there is nowhere for words on the whole, or a verdict
      const r = await hostNow.submit(onHost() ? verdict() : "comment", onHost() ? body() : "");
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
      <div class="composer-head">
        <strong>Finish your review</strong>
        <span>{count() === 0 ? "no comments pending" : count() === 1 ? "1 comment pending" : `${count()} comments pending`}</span>
      </div>
      <Show when={onHost()}>
      <textarea
        placeholder={verdict() === "approve" ? "Anything to add (optional)" : count() > 0 && verdict() === "comment" ? "Leave a comment on the whole (optional)" : "Leave a comment"}
        value={body()}
        onInput={(e) => setBody(e.currentTarget.value)}
        rows={4}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
        }}
      />
      <fieldset class="verdicts">
        {VERDICTS.map((v) => (
          <label title={v.hint}>
            <input type="radio" name="verdict" value={v.value} checked={verdict() === v.value} onChange={() => setVerdict(v.value)} />
            {v.label}
          </label>
        ))}
      </fieldset>
      </Show>
      <Show when={!onHost()}>
        <p class="host-note left">
          {pull()?.mine ? "Your own pull request: your comments stay in collagen — on GitHub you would be their only reader." : "Your comments are said in the room — there is no open pull request to put them on."} A word on the whole, or a verdict, goes through your agent.
        </p>
      </Show>
      <Show when={said()}>{(why) => <p class="host-error">{why()}</p>}</Show>
      <div class="composer-actions">
        <Show when={count() > 0}>
          <button type="button" class="quiet discard" onClick={() => void hostNow.unpend(null)} title="Take every pending comment out of the review — said nowhere">
            Discard review
          </button>
        </Show>
        <button type="button" class="quiet" onClick={() => props.onDone()}>
          Cancel
        </button>
        <button type="submit" class="banner-go" disabled={!ready()}>
          {sending() ? "Submitting…" : "Submit review"}
        </button>
      </div>
    </form>
  );
}
