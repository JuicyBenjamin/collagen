import { For, Show } from "solid-js";
import type { FollowUpView } from "~/data";
import { Block } from "./Block";
import { More } from "./More";
import { Outcome } from "./Outcome";

/** A follow-up written on the goal whose 'if' held, set in beneath it: the
 *  condition, what was looked into, and what that found. */
export function FollowUp(props: { follow: FollowUpView }) {
  return (
    <div class="inv-follow">
      <p class="inv-follow-if">If {props.follow.if}, then</p>
      <h4>
        {props.follow.title} <Outcome outcome={props.follow.outcome} />
      </h4>
      <For each={props.follow.blocks}>{(block) => <Block block={block} />}</For>
      <Show when={props.follow.blocks.length === 0 && props.follow.more}>{(text) => <p class="inv-plain">{text()}</p>}</Show>
      <Show when={props.follow.blocks.length > 0 && props.follow.more}>{(text) => <More text={text()} />}</Show>
    </div>
  );
}
