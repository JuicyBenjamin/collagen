import { Show } from "solid-js";
import type { Decision } from "../data";
import { assumedNow } from "../assumedNow";
import { questionFor, spotFor } from "../assumed";
import { diffNow } from "../diffNow";
import { hostNow } from "../hostNow";

const SURE = { high: "the author said as much", medium: "the code makes it likely", low: "a reading of the code" } as const;

/** What a guess rests on and how sure the AI is — in place of the person's
 *  words and the agent's reasons a told decision has. */
export function AssumedWhy(props: { decision: Decision }) {
  return (
    <>
      <Show when={props.decision.basis}>
        {(basis) => (
          <div class="why-part">
            <p class="who">Rests on</p>
            <p class="quote">{basis()}</p>
          </div>
        )}
      </Show>
      <Show when={props.decision.agentWhy}>
        {(why) => (
          <div class="why-part">
            <p class="who">The AI's reading</p>
            <p>{why()}</p>
          </div>
        )}
      </Show>
      <Check decision={props.decision} />
    </>
  );
}

/** The mark an assumption carries everywhere it is drawn. */
export function AssumedMark(props: { confidence?: "high" | "medium" | "low" }) {
  return (
    <p class="assumed-mark" title={props.confidence ? `${props.confidence} confidence: ${SURE[props.confidence]}` : "inferred, not told"}>
      Assumption{props.confidence ? ` · ${props.confidence} confidence` : ""}
    </p>
  );
}

/** What the code's author made of a guess, once they took the review over. */
export function VerdictMark(props: { verdict?: "confirmed" | "corrected" | "wrong" }) {
  const by = () => assumedNow.claimedBy() ?? "its author";
  return (
    <Show when={props.verdict}>
      {(v) => (
        <p class={["verdict-mark", v()]}>
          {v() === "confirmed" ? `Guessed, confirmed by ${by()}` : v() === "corrected" ? `Guessed wrong, corrected by ${by()}` : `Guessed wrong, says ${by()}`}
        </p>
      )}
    </Show>
  );
}

/** The reader's verdict on one guess: it holds — or it goes to the author as
 *  a question, pending in the reader's review, on the line it is about. */
function Check(props: { decision: Decision }) {
  const author = () => assumedNow.assumed()?.author ?? "the author";
  const state = () => assumedNow.checks.check(props.decision.id);
  const spot = () => spotFor(props.decision.where, diffNow.hunksOf);
  const ask = async () => {
    const at = spot();
    if (!at) return;
    const r = await hostNow.addToReview(at.file, "RIGHT", at.line, questionFor(props.decision), null);
    if ("ok" in r) assumedNow.checks.set(props.decision.id, "asked");
  };
  return (
    <div class="assumed-check">
      <Show
        when={state()}
        fallback={
          <>
            <button type="button" class="quiet small" onClick={() => assumedNow.checks.set(props.decision.id, "holds")} title="You read the code and the guess is right">
              Holds
            </button>
            <button
              type="button"
              class="quiet small"
              disabled={spot() === null}
              onClick={() => void ask()}
              title={spot() ? `A question to ${author()} on ${spot()!.file}:${spot()!.line}, pending in your review — edit it there` : "Its code is not in this diff: ask in the review's words instead"}
            >
              Ask {author()}
            </button>
          </>
        }
      >
        {(s) => (
          <p class="assumed-done">
            {s() === "holds" ? "✓ You checked it: it holds." : `Asked ${author()} — the question is pending in your review, under its line.`}
            <button type="button" class="link" onClick={() => assumedNow.checks.set(props.decision.id, null)}>
              Undo
            </button>
          </p>
        )}
      </Show>
    </div>
  );
}
