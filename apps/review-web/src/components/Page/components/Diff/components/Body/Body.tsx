import { createEffect, createMemo, For, Show } from "solid-js";
import {
  toolOf,
  type Decision,
  type Hunk as HunkData,
  type ReviewPageData,
  type Unit as UnitData,
} from "~/data";
import { assumedNow } from "~/assumedNow";
import { diffNow } from "~/diffNow";
import { tab } from "~/testsNow";
import { viewed } from "~/viewedNow";
import { Unit } from "../Unit";
import { BareDecision } from "./components/BareDecision";
import { Forks } from "./components/Forks";
import { Machine } from "./components/Machine";
import { Outside } from "./components/Outside";
import { Tabs } from "./components/Tabs";
import { Tests } from "./components/Tests";
import { TypesBanner } from "./components/TypesBanner";

/** The diff once read: an offer of type hints per language in it, its
 *  units (else its decisions alone, with no code), what falls outside it,
 *  and where the diff came from. Its tests are apart, in a tab of their own,
 *  and so is how it works, when its author drew that. */
export function Body(props: { data: ReviewPageData }) {
  const hunks = createMemo(
    () =>
      new Map<string, HunkData>((props.data.grouped?.hunks ?? []).map((hunk) => [hunk.id, hunk])),
  );
  const decisions = createMemo(
    () => new Map(props.data.review.decisions.map((decision) => [decision.id, decision])),
  );
  // the units each decision shaped — a decision spanning units links the others
  const unitsOf = createMemo(() => {
    const byDecision = new Map<string, Array<UnitData>>();
    for (const unit of props.data.grouped?.units ?? [])
      for (const decisionId of unit.decisions)
        byDecision.set(decisionId, [...(byDecision.get(decisionId) ?? []), unit]);
    return byDecision;
  });
  const tests = () => props.data.grouped?.tests ?? [];
  // the tab asked for, if this review has what it shows
  const shown = () =>
    tab() === "tests" && tests().length > 0 ? "tests" : tab() === "machine" && props.data.review.machine ? "machine" : "code";
  // the files a mark can be for, as this diff has them — tests are judged, not viewed
  createEffect(
    () => props.data.grouped?.hunks ?? [],
    (all) => {
      const testFiles = new Set(tests().map((file) => file.file));
      viewed.setFiles(all.filter((hunk) => !testFiles.has(hunk.file)));
      diffNow.set(all, props.data.source.kind === "clone", props.data.commit);
    },
  );
  // a why guessed, not told: every decision and fork drawn knows it
  createEffect(
    () => props.data.review.assumed,
    (assumed) => {
      assumedNow.setAssumed(assumed);
    },
  );
  createEffect(
    () => (props.data.review.claimed ? props.data.review.authorName : undefined),
    (by) => {
      assumedNow.setClaimedBy(by);
    },
  );
  return (
    <>
      {/* one offer per language the review's code is in */}
      <For
        each={[
          ...new Set(
            (props.data.grouped?.hunks ?? [])
              .map((hunk) => toolOf(hunk.file))
              .filter((tool) => tool !== null),
          ),
        ]}
      >
        {(tool) => <TypesBanner tool={tool} />}
      </For>
      <Show when={tests().length > 0 || props.data.review.machine}>
        <Tabs tests={tests()} machine={props.data.review.machine !== undefined} />
      </Show>
      <Show when={shown() === "tests"}>
        <Tests files={tests()} hunks={hunks()} decisions={decisions()} />
      </Show>
      <Show when={shown() === "machine" && props.data.review.machine}>
        {(machine) => <Machine machine={machine()} />}
      </Show>
      <Show when={shown() === "code"}>
      <Show
        when={props.data.grouped}
        fallback={
          <>
            {/* by id: the data is read again whenever the review moves (a draft
                accepted, a guess answered), and what was folded stays folded */}
            <For each={props.data.review.decisions} keyed={(decision) => decision.id}>
              {(decision) => <BareDecision decision={decision()} why={props.data.source.detail} />}
            </For>
            <Forks title="Forks in the road" forks={props.data.review.forks} />
          </>
        }
      >
        {(grouped) => (
          <>
            {/* by id, so a unit's folded why stays folded when the data is read again */}
            <For each={grouped().units} keyed={(unit) => unit.id}>
              {(unit) => (
                <Unit
                  unit={unit()}
                  of={grouped().units.find((other) => other.id === unit().uses?.of)}
                  hunks={hunks()}
                  decisions={decisions()}
                  unitsOf={unitsOf()}
                  unmatched={grouped().unmatched}
                />
              )}
            </For>
            <Outside
              decisions={grouped()
                .outside.map((id) => decisions().get(id))
                .filter((decision): decision is Decision => decision !== undefined)}
              unmatched={grouped().unmatched}
            />
            <Forks title="Forks outside the diff" forks={grouped().looseForks} />
          </>
        )}
      </Show>
      </Show>
      <footer class="note">
        <p>
          A review or comment sent from here goes to the pull request on its host, in your name,
          and your verdict on the collagen ticket, as your take.
        </p>
        <p title={props.data.source.detail}>
          {props.data.source.kind === "clone"
            ? "Diff read from your own clone."
            : props.data.source.kind === "host"
              ? "Diff read from the host, not your clone."
              : `No diff: ${props.data.source.detail}`}
        </p>
      </footer>
    </>
  );
}
