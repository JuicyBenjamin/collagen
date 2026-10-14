import { For, Show } from "solid-js";
import type { StackStep } from "~/data";
import { Appear } from "~/components/Appear";
import { hostNow } from "~/hostNow";

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
    <Appear when={hostNow.stack()}>
      {(stack) => (
        <div class="stack-row" role="navigation" aria-label="The stack this branch sits in">
          <span class="who">Stack</span>
          <For each={stack().below}>
            {(step) => (
              <>
                <Step step={step} />
                <span class="stack-sep">›</span>
              </>
            )}
          </For>
          <span class="stack-step here" title={stack().here.branch}>
            {stack().here.number !== undefined ? `#${stack().here.number} ` : ""}this one
          </span>
          <For each={stack().above}>
            {(step) => (
              <>
                <span class="stack-sep">›</span>
                <Step step={step} />
              </>
            )}
          </For>
          <Show when={stack().split.length > 0}>
            <span class="stack-sep">›</span>
            <span class="stack-split" title="Several branches build on this one">
              <For each={stack().split}>
                {(step, index) => (
                  <>
                    {index() > 0 ? <span class="stack-sep"> / </span> : null}
                    <Step step={step} />
                  </>
                )}
              </For>
            </span>
          </Show>
        </div>
      )}
    </Appear>
  );
}
