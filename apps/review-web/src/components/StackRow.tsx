import { For, Show } from "solid-js";
import type { StackStep } from "../data";
import { hostNow } from "../hostNow";

/** One step of the stack: a pull request (by number, its title on hover), a
 *  review in the room, or the trunk — each opens where it is read. */
function Step(props: { step: StackStep }) {
  const text = () => (props.step.number !== undefined ? `#${props.step.number}` : props.step.label);
  return (
    <Show when={props.step.url} fallback={<span class={["stack-step", props.step.kind]}>{text()}</span>}>
      {(url) => (
        <a class={["stack-step", props.step.kind]} href={url()} title={`${props.step.label} — ${props.step.branch}`} {...(props.step.kind === "pull" ? { target: "_blank", rel: "noreferrer" } : {})}>
          {text()}
        </a>
      )}
    </Show>
  );
}

/** Where the review's branch sits when it is part of a stack: what it is
 *  built on, from the trunk up, then this one, then what builds on it — read
 *  from the host's open pull requests and the room's own reviews. Nothing
 *  when the branch stands alone on the trunk. */
export function StackRow() {
  return (
    <Show when={hostNow.stack()}>
      {(s) => (
        <div class="stack-row" role="navigation" aria-label="The stack this branch sits in">
          <span class="who">Stack</span>
          <For each={s().below}>
            {(step) => (
              <>
                <Step step={step} />
                <span class="stack-sep">›</span>
              </>
            )}
          </For>
          <span class="stack-step here" title={s().here.branch}>
            {s().here.number !== undefined ? `#${s().here.number} ` : ""}this one
          </span>
          <For each={s().above}>
            {(step) => (
              <>
                <span class="stack-sep">›</span>
                <Step step={step} />
              </>
            )}
          </For>
          <Show when={s().split.length > 0}>
            <span class="stack-sep">›</span>
            <span class="stack-split" title="Several branches build on this one">
              <For each={s().split}>
                {(step, i) => (
                  <>
                    {i() > 0 ? <span class="stack-sep"> / </span> : null}
                    <Step step={step} />
                  </>
                )}
              </For>
            </span>
          </Show>
        </div>
      )}
    </Show>
  );
}
