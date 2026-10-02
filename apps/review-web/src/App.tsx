import { createEffect, createMemo, createSignal, Errored, For, Loading, onSettled, Show } from "solid-js";
import type { Decision, Fork as ForkData, Hunk as HunkData, ReviewPageData, Section } from "./data";
import { Fork } from "./components/Fork";
import { Hunk } from "./components/Hunk";
import { Popover } from "./components/Popover";
import { TypesBanner } from "./components/TypesBanner";
import { typed } from "./highlight";
import { ticketId } from "./ticket";

// The review page: a review ticket's diff read by intent. One section per
// decision — its title, and the code it produced, front and centre; beside
// it, quieter, the why (how the person steered it, what their agent
// reasoned) and the forks in the road. Then every hunk no decision claims:
// "not explained", itself a finding. Ids, pointers and where the diff came
// from are plumbing — kept out of the reader's way. Read-only: a take goes
// back through the person's agent (post-review).

async function load(): Promise<ReviewPageData> {
  const res = await fetch(`/review/${encodeURIComponent(ticketId)}/data`);
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as ReviewPageData;
}

// the instance says when the review changed — its why revised, the ticket
// moved, the branch's commit in the clone — and the page reloads in place:
// what is on screen stays until the new data is in
const [version, setVersion] = createSignal(0);

export function App() {
  const data = createMemo(() => {
    version();
    return load();
  });
  onSettled(() => {
    const events = new EventSource(`/review/${encodeURIComponent(ticketId)}/events`);
    events.addEventListener("changed", () => setVersion((v) => v + 1));
    return () => events.close();
  });
  return (
    <Errored fallback={(err) => <p class="failed">{String(err())}</p>}>
      <Loading fallback={<p class="loading">Reading the review…</p>}>
        <Page data={data()} />
        <Popover />
      </Loading>
    </Errored>
  );
}

/** A decision with nothing of the diff, for a review read without one. */
const bare = (decision: Decision): Section => ({ decision, hunks: [], shared: [], forks: [], unmatched: [] });

/** Below this width the why folds under the title instead of sitting beside
 *  the code — the code keeps the room (styles.css says the same). */
const NARROW = "(max-width: 1320px)";

// wide enough to sit beside the code: open; folded otherwise — and it
// follows the window when it is resized across the line
const narrow = matchMedia(NARROW);
const [wide, setWide] = createSignal(!narrow.matches);
narrow.addEventListener("change", (e) => setWide(!e.matches));

/** "2 changes" — a count in words, for the outline. */
const changes = (n: number) => (n === 1 ? "1 change" : `${n} changes`);

function Page(props: { data: ReviewPageData }) {
  const hunks = createMemo(() => new Map<string, HunkData>((props.data.grouped?.hunks ?? []).map((h) => [h.id, h])));
  const sections = createMemo(() => props.data.grouped?.sections ?? props.data.review.decisions.map(bare));
  // which decisions claim each hunk — a hunk under two says where else it is
  const claimedBy = createMemo(() => {
    const m = new Map<string, Array<Decision>>();
    for (const s of sections()) for (const id of s.hunks) m.set(id, [...(m.get(id) ?? []), s.decision]);
    return m;
  });
  createEffect(
    () => props.data.ticket.goal,
    (goal) => {
      document.title = `${goal} — review`;
    },
  );

  return (
    <div class="wrap">
      <nav aria-label="Decisions">
        <p class="nav-title">Decisions</p>
        <ol>
          <For each={sections()}>
            {(s) => (
              <li>
                <a href={`#${s.decision.id}`}>
                  <span class="nav-what">{s.decision.what}</span>
                  <Show when={props.data.grouped}>
                    <span class="count">{changes(s.hunks.length)}</span>
                  </Show>
                </a>
              </li>
            )}
          </For>
          <Show when={props.data.grouped}>
            {(g) => (
              <Show when={g().unexplained.length > 0}>
                <li class="nav-unexplained">
                  <a href="#unexplained">
                    <span class="nav-what">Not explained</span>
                    <span class="count">{changes(g().unexplained.length)}</span>
                  </a>
                </li>
              </Show>
            )}
          </Show>
        </ol>
      </nav>

      <main>
        <Header data={props.data} />
        <Show when={(props.data.grouped?.hunks ?? []).some((h) => typed(h.file))}>
          <TypesBanner />
        </Show>
        <For each={sections()}>
          {(s) => <DecisionSection section={s} hunks={hunks()} claimedBy={claimedBy()} diffed={props.data.grouped !== null} />}
        </For>
        <Show
          when={props.data.grouped}
          fallback={
            <Show when={props.data.review.forks.length > 0}>
              <section class="decision">
                <h2>Forks in the road</h2>
                <For each={props.data.review.forks}>{(f) => <Fork fork={f} />}</For>
              </section>
            </Show>
          }
        >
          {(g) => <Unexplained ids={g().unexplained} forks={g().looseForks} hunks={hunks()} />}
        </Show>
        <footer class="note">
          <p>Read-only. Say what you think through your agent — it posts your review on the ticket.</p>
          <p title={props.data.source.detail}>
            {props.data.source.kind === "clone"
              ? "Diff read from your own clone."
              : props.data.source.kind === "host"
                ? "No clone of this project here — diff read from the host."
                : `No diff: ${props.data.source.detail}`}
          </p>
        </footer>
      </main>
    </div>
  );
}

function Header(props: { data: ReviewPageData }) {
  return (
    <header>
      <h1>{props.data.ticket.goal}</h1>
      <p class="meta">
        <Show when={props.data.review.branch}>
          {(branch) => (
            <>
              <code>{branch()}</code> into <code>{props.data.review.base ?? "main"}</code> ·{" "}
            </>
          )}
        </Show>
        by {props.data.review.authorName}
        <For each={props.data.links}>
          {(l) => (
            <>
              {" · "}
              <a href={l.url} target="_blank" rel="noreferrer">
                {l.label}
              </a>
            </>
          )}
        </For>
      </p>
      <p class="summary">{props.data.review.summary}</p>
    </header>
  );
}

/** The why beside the code: how the person steered it, what the agent
 *  reasoned, the forks — quieter than the code, and on a narrow screen
 *  folded away until asked for. */
function Why(props: { section: Section }) {
  const has = () => !!props.section.decision.userWhy || !!props.section.decision.agentWhy || props.section.forks.length > 0 || props.section.unmatched.length > 0;
  return (
    <Show when={has()}>
      <details class="why" open={wide()}>
        <summary>Why</summary>
        <Show when={props.section.decision.userWhy}>
          {(why) => (
            <div class="why-part">
              <p class="who">The person</p>
              <p class="quote">{why()}</p>
            </div>
          )}
        </Show>
        <Show when={props.section.decision.agentWhy}>
          {(why) => (
            <div class="why-part">
              <p class="who">The agent</p>
              <p>{why()}</p>
            </div>
          )}
        </Show>
        <For each={props.section.forks}>{(f) => <Fork fork={f} />}</For>
        <Show when={props.section.unmatched.length > 0}>
          <p class="stale" title={props.section.unmatched.join(", ")}>
            Points at code this diff does not change — the why may be older than the branch.
          </p>
        </Show>
      </details>
    </Show>
  );
}

function DecisionSection(props: { section: Section; hunks: ReadonlyMap<string, HunkData>; claimedBy: ReadonlyMap<string, ReadonlyArray<Decision>>; diffed: boolean }) {
  const others = (id: string) => (props.claimedBy.get(id) ?? []).filter((d) => d.id !== props.section.decision.id);
  return (
    <section class="decision" id={props.section.decision.id}>
      <h2>{props.section.decision.what}</h2>
      <div class="decision-main">
        <For each={props.section.hunks}>{(id) => <Show when={props.hunks.get(id)}>{(h) => <Hunk hunk={h()} alsoUnder={others(id)} />}</Show>}</For>
        <Show when={props.diffed && props.section.hunks.length === 0}>
          <p class="empty">No change in this diff for this decision.</p>
        </Show>
      </div>
      <Why section={props.section} />
    </section>
  );
}

function Unexplained(props: { ids: ReadonlyArray<string>; forks: ReadonlyArray<ForkData>; hunks: ReadonlyMap<string, HunkData> }) {
  return (
    <Show when={props.ids.length > 0 || props.forks.length > 0}>
      <section class="decision unexplained" id="unexplained">
        <h2>Not explained</h2>
        <div class="decision-main">
          <p class="lead">Changes no decision covers. Worth a question to the author.</p>
          <For each={props.ids}>{(id) => <Show when={props.hunks.get(id)}>{(h) => <Hunk hunk={h()} alsoUnder={[]} />}</Show>}</For>
        </div>
        <Show when={props.forks.length > 0}>
          <details class="why" open>
            <summary>Forks outside every decision</summary>
            <For each={props.forks}>{(f) => <Fork fork={f} />}</For>
          </details>
        </Show>
      </section>
    </Show>
  );
}
