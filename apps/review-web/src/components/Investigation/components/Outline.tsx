import { For, Show } from "solid-js";
import type { GoalView } from "~/data";

/** The goals by their titles, in their groups, and the questions — the
 *  review page's outline, the same plain links. */
export function Outline(props: { groups: ReadonlyArray<{ readonly name: string | null; readonly goals: ReadonlyArray<GoalView> }>; questions: number }) {
  return (
    <nav aria-label="Goals" class="inv-outline">
      <For each={props.groups}>
        {(group) => (
          <>
            <Show when={group.name}>{(name) => <p class="inv-outline-group">{name()}</p>}</Show>
            <ol>
              <For each={group.goals}>
                {(goal) => (
                  <li>
                    <a href={`#${goal.id}`}>{goal.title}</a>
                  </li>
                )}
              </For>
            </ol>
          </>
        )}
      </For>
      <Show when={props.questions > 0}>
        <p class="inv-outline-group">For you</p>
        <ol>
          <li>
            <a href="#questions" class="inv-outline-count">
              Questions<span>{props.questions}</span>
            </a>
          </li>
        </ol>
      </Show>
    </nav>
  );
}
