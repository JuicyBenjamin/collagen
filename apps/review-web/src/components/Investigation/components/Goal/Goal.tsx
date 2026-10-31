import { For } from "solid-js";
import type { GoalView } from "~/data";
import { Answer } from "./components/Answer";

/** One goal: its title, the question beneath, and each person's answer —
 *  named only when more than one person answered it. Waiting on its run:
 *  said so, in a line. */
export function Goal(props: { goal: GoalView }) {
  return (
    <article id={props.goal.id} class="card card-border inv-goal">
      <div class="card-body">
        <div class="inv-goal-head">
          <h3 class="card-title">{props.goal.title}</h3>
          {props.goal.ask && <p class="inv-ask">{props.goal.ask}</p>}
        </div>
        <For each={props.goal.answers} fallback={<p class="inv-waiting">Not answered yet</p>}>
          {(answer) => <Answer answer={answer} named={props.goal.answers.length > 1} />}
        </For>
      </div>
    </article>
  );
}
