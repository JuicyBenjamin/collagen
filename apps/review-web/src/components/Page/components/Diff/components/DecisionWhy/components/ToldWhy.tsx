import { Markdown } from "~/components/Markdown";
import { For, Show } from "solid-js";
import type { Decision } from "~/data";

/** A told decision's why: what guided the agent, the person's words and the agent's reasons. */
export function ToldWhy(props: { decision: Decision }) {
  return (
    <>
      {/* what told the agent to do it this way: right beside its code, so a
          skill that points the wrong way is seen where it did */}
      <Show when={props.decision.guidedBy?.length ? props.decision.guidedBy : null}>
        {(by) => (
          <p class="guided-by">
            Guided by{" "}
            <For each={by()}>
              {(skill, index) => (
                <>
                  {index() > 0 ? ", " : ""}
                  <code>{skill}</code>
                </>
              )}
            </For>
          </p>
        )}
      </Show>
      <Show when={props.decision.userWhy}>
        {(why) => (
          <div class="why-part">
            <p class="who">The person</p>
            <p class="quote">{why()}</p>
          </div>
        )}
      </Show>
      <Show when={props.decision.agentWhy}>
        {(why) => (
          <div class="why-part">
            <p class="who">The agent</p>
            <Markdown text={why()} />
          </div>
        )}
      </Show>
    </>
  );
}
