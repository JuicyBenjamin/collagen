import { For, Show } from "solid-js";
import type { InvestigationPage } from "~/data";
import { KindIcon } from "~/components/KindIcon";

/** The investigation: its title and whether it is open, the question as
 *  asked, who opened it, and, as labelled facts, how far its goals are,
 *  whose answers are on it and with which models. */
export function Header(props: { page: InvestigationPage }) {
  return (
    <header class="inv-header">
      <p class="inv-kind">
        <KindIcon kind="investigation" />
        Investigation
      </p>
      <div class="inv-title">
        <h1>{props.page.title}</h1>
        <span class="badge badge-outline">{props.page.open ? "Open" : "Closed"}</span>
      </div>
      <p class="inv-question">{props.page.question}</p>
      <p class="inv-opened">Opened by {props.page.openedBy}</p>
      <dl class="inv-facts">
        <div>
          <dt>Goals</dt>
          <dd>
            <progress class="progress progress-success" value={props.page.done} max={props.page.total} />
            {props.page.done} of {props.page.total} complete
          </dd>
        </div>
        <Show when={props.page.people.length > 0}>
          <div>
            <dt>Answers from</dt>
            <dd>
              <For each={props.page.people}>
                {(person) => (
                  <span class="inv-person">
                    <span class="inv-avatar" aria-hidden="true">
                      {person.slice(0, 1).toUpperCase()}
                    </span>
                    {person}
                  </span>
                )}
              </For>
            </dd>
          </div>
        </Show>
        <Show when={props.page.models.length > 0}>
          <div>
            <dt>{props.page.models.length === 1 ? "Model" : "Models"}</dt>
            <dd class="inv-models">
              <For each={props.page.models}>
                {(model) => (
                  <span>
                    {model.name}, {model.runs === 1 ? "1 run" : `${model.runs} runs`}
                  </span>
                )}
              </For>
            </dd>
          </div>
        </Show>
      </dl>
    </header>
  );
}
