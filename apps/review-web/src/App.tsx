import { createEffect, createMemo, createSignal, Errored, For, Loading, Show } from "solid-js";
import { NO_TITLE, toolOf, type Decision, type Fork as ForkData, type Hunk as HunkData, type ReviewPageData, type Section } from "./data";
import { Fork } from "./components/Fork";
import { Hunk } from "./components/Hunk";
import { Popover } from "./components/Popover";
import { TypesBanner } from "./components/TypesBanner";
import { ticketId } from "./ticket";
import { viewed } from "./viewedNow";
import { reviewChanges, reviewData } from "./api";
import { diffNow } from "./diffNow";

// The review page: a review ticket's diff read by intent. One section per
// decision — its title, and the code it produced, front and centre; beside
// it, quieter, the why (how the person steered it, what their agent
// reasoned) and the forks in the road. Then every hunk no decision claims:
// "not explained", itself a finding. Ids, pointers and where the diff came
// from are plumbing — kept out of the reader's way. Read-only: a take goes
// back through the person's agent (post-review).

async function load(): Promise<ReviewPageData> {
  const data = await reviewData(ticketId);
  if (!data) throw new Error(`no review ticket ${ticketId} in your rooms`);
  return data;
}

export function App() {
  // the review's state, from a live server function held open while the
  // page is: a token that moves when its why is revised, the ticket moves,
  // or the branch's commit in the clone changes (a reconnect re-reads it)
  const state = createMemo(() => reviewChanges(ticketId));
  // its data, read again whenever that state moves — what is on screen
  // stays until the new data is in
  const data = createMemo(() => {
    state();
    return load();
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
  // the files a mark can be for, as this diff has them
  createEffect(
    () => props.data.grouped?.hunks ?? [],
    (all) => {
      viewed.setFiles(all);
      diffNow.set(all, props.data.source.kind === "clone", props.data.commit);
    },
  );
  createEffect(
    () => props.data.ticket.title ?? props.data.ticket.goal,
    (name) => {
      document.title = `${name} — review`;
    },
  );

  return (
    <div class="wrap">
      <nav aria-label="Decisions">
        <p class="nav-title">Decisions</p>
        <Show when={viewed.count().files > 0}>
          <p class={["nav-viewed", { done: viewed.count().viewed === viewed.count().files }]}>
            {viewed.count().viewed} of {viewed.count().files} files viewed
          </p>
        </Show>
        <ol>
          <For each={sections()}>
            {(s) => (
              <li>
                <a href={`#${s.decision.id}`}>
                  <span class={["nav-what", { untitled: !s.decision.title }]}>{s.decision.title ?? NO_TITLE}</span>
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
        {/* one offer per language the review's code is in */}
        <For each={[...new Set((props.data.grouped?.hunks ?? []).map((h) => toolOf(h.file)).filter((t) => t !== null))]}>{(tool) => <TypesBanner tool={tool} />}</For>
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
  // a review's goal is its branch's name unless someone wrote one; its
  // summary is the purpose — so on a review the purpose is the headline and
  // where the code is sits above it, small
  const purposeFirst = () => props.data.ticket.kind === "review" && props.data.review.summary.trim().length > 0;
  return (
    <header>
      <Show when={!purposeFirst()}>
        <h1>{props.data.ticket.title ?? props.data.ticket.goal}</h1>
      </Show>
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
      <Show when={purposeFirst()} fallback={<p class="summary">{props.data.review.summary}</p>}>
        <h1 class="purpose">{props.data.review.summary}</h1>
      </Show>
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
      {/* the headline, and what was done beneath it */}
      <div class="decision-head">
        <h2 class={{ untitled: !props.section.decision.title }}>{props.section.decision.title ?? NO_TITLE}</h2>
        <p class="decision-what">{props.section.decision.what}</p>
        {/* what told the agent to do it this way: right beside its code, so a
            skill that points the wrong way is seen where it did */}
        <Show when={props.section.decision.guidedBy?.length ? props.section.decision.guidedBy : null}>
          {(by) => (
            <p class="guided-by">
              Guided by <For each={by()}>{(s, i) => <>{i() > 0 ? ", " : ""}<code>{s}</code></>}</For>
            </p>
          )}
        </Show>
      </div>
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
