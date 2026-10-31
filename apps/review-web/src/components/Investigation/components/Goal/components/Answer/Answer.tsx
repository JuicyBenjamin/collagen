import { For, Show } from "solid-js";
import type { AnswerView } from "~/data";
import { Block } from "./components/Block";
import { FollowUp } from "./components/FollowUp";
import { More } from "./components/More";
import { Outcome } from "./components/Outcome";
import { Sources } from "./components/Sources";

/** One person's answer to a goal: the blocks their run chose, the
 *  follow-ups it looked into, where it came from, and the full findings
 *  folded beneath when they say more. An answer from before blocks is its
 *  findings, shown as they are. */
export function Answer(props: { answer: AnswerView; named: boolean }) {
  return (
    <div class="inv-answer">
      <Show when={props.named || props.answer.outcome !== "answered"}>
        <p class="inv-answer-head">
          <Show when={props.named}>
            <span class="inv-by">{props.answer.by}</span>
          </Show>
          <Outcome outcome={props.answer.outcome} />
        </p>
      </Show>
      <For each={props.answer.blocks}>{(block) => <Block block={block} />}</For>
      <Show when={props.answer.blocks.length === 0 && props.answer.more}>{(text) => <p class="inv-plain">{text()}</p>}</Show>
      <For each={props.answer.followUps}>{(follow) => <FollowUp follow={follow} />}</For>
      <Sources sources={props.answer.sources} />
      <Show when={props.answer.blocks.length > 0 && props.answer.more}>{(text) => <More text={text()} />}</Show>
    </div>
  );
}
