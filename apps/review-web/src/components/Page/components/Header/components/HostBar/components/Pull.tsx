import { createEffect, Show } from "solid-js";
import type { PullRequest } from "~/data";
import { Arrives } from "~/components/Arrives";
import { Masked } from "~/components/Masked";
import { hostNow } from "~/hostNow";
import { kept } from "~/kept";
import { ticketId } from "~/ticket";

/** What the pull request said last time: its chip, or why there is none. */
type Said = { readonly chip: string } | { readonly note: string };
const lastSaid = kept(
  `collagen.pull.v1.${ticketId}`,
  (value): value is Said =>
    typeof value === "object" && value !== null && ("chip" in value || "note" in value),
);

/** The pull request's chip, as it reads. */
const chipText = (pull: PullRequest): string =>
  `#${pull.number} · ${pull.draft ? "draft" : pull.state}${pull.decision ? ` · ${pull.decision}` : ""}`;

/** The review's pull request: its number, state and decision, a link to it
 *  — or, quietly, why there is none. Waits on the host. */
export function Pull() {
  createEffect(
    () => hostNow.host(),
    (host) => {
      if (host)
        lastSaid.keep(host.pull ? { chip: chipText(host.pull) } : { note: host.noPull ?? "" });
    },
  );
  return (
    <Arrives inline skeleton={Pull.Skeleton} ready={hostNow.view() !== null}>
      <Show when={hostNow.host()}>
        {(host) => (
          <Show when={host().pull} fallback={<span class="host-note">{host().noPull ?? ""}</span>}>
            {(pull) => (
              <a
                class={["pull-chip", pull().state]}
                href={pull().url}
                target="_blank"
                rel="noreferrer"
                title={pull().title}
              >
                {chipText(pull())}
              </a>
            )}
          </Show>
        )}
      </Show>
    </Arrives>
  );
}

/** As wide as what stood there last time: a chip's shape, or the note's words. */
Pull.Skeleton = function Skeleton() {
  const said = lastSaid.last;
  return (
    <span class="sk" aria-hidden="true">
      {said && "chip" in said ? (
        <span class="pull-chip">
          <Masked>{said.chip}</Masked>
        </span>
      ) : (
        <span class="host-note">
          <Masked>{said && "note" in said ? said.note : "No pull request yet"}</Masked>
        </span>
      )}
    </span>
  );
};
