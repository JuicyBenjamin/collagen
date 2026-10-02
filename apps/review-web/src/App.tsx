import { createEffect, createMemo, Errored, For, Loading, Show } from "solid-js";
import type { Decision, Fork as ForkData, Hunk as HunkData, ReviewPageData, Section } from "./data";
import { Fork } from "./components/Fork";
import { Hunk } from "./components/Hunk";

// The review page: a review ticket's diff read by intent. One section per
// decision — what was decided, how the person steered it, what their agent
// reasoned, the hunks at its lines, the forks in them — then every hunk no
// decision claims: "not explained", itself a finding. Read-only: a take goes
// back through the person's agent (post-review).

/** /review/<ticketId> — the one thing the url carries. */
const ticketId = decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] ?? "");

async function load(): Promise<ReviewPageData> {
  const res = await fetch(`/review/${encodeURIComponent(ticketId)}/data`);
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as ReviewPageData;
}

export function App() {
  const data = createMemo(() => load());
  return (
    <Errored fallback={(err) => <p class="source none">{String(err())}</p>}>
      <Loading fallback={<p class="meta loading">reading the review…</p>}>
        <Page data={data()} />
      </Loading>
    </Errored>
  );
}

/** A decision with nothing of the diff, for a review read without one. */
const bare = (decision: Decision): Section => ({ decision, hunks: [], shared: [], forks: [], unmatched: [] });

function Page(props: { data: ReviewPageData }) {
  const hunks = createMemo(() => new Map<string, HunkData>((props.data.grouped?.hunks ?? []).map((h) => [h.id, h])));
  const sections = createMemo(() => props.data.grouped?.sections ?? props.data.review.decisions.map(bare));
  createEffect(
    () => props.data.ticket.goal,
    (goal) => {
      document.title = `${goal} — review by intent`;
    },
  );

  return (
    <div class="wrap">
      <nav aria-label="Decisions">
        <strong>decisions</strong>
        <ol>
          <For each={sections()}>
            {(s) => (
              <li>
                <a href={`#${s.decision.id}`}>
                  {s.decision.id} {s.decision.what.slice(0, 60)}
                  <Show when={props.data.grouped}>
                    <span class="count">{s.hunks.length}</span>
                  </Show>
                </a>
              </li>
            )}
          </For>
          <Show when={props.data.grouped}>
            {(g) => (
              <li>
                <a href="#unexplained">
                  not explained<span class="count">{g().unexplained.length}</span>
                </a>
              </li>
            )}
          </Show>
        </ol>
      </nav>

      <main>
        <Header data={props.data} />
        <For each={sections()}>{(s) => <DecisionSection section={s} hunks={hunks()} diffed={props.data.grouped !== null} />}</For>
        <Show
          when={props.data.grouped}
          fallback={
            <Show when={props.data.review.forks.length > 0}>
              <section class="decision">
                <h2>forks in the road</h2>
                <For each={props.data.review.forks}>{(f) => <Fork fork={f} />}</For>
              </section>
            </Show>
          }
        >
          {(g) => <Unexplained ids={g().unexplained} forks={g().looseForks} hunks={hunks()} />}
        </Show>
        <p class="note">Read-only. Say what you think through your agent — it posts your review on the ticket.</p>
      </main>
    </div>
  );
}

function Header(props: { data: ReviewPageData }) {
  return (
    <header>
      <h1>{props.data.ticket.goal}</h1>
      <div class="meta">
        {props.data.ticket.kind} · {props.data.ticket.project} ·{" "}
        <Show when={props.data.review.branch} fallback="no branch">
          {(branch) => (
            <>
              <code>{branch()}</code> → <code>{props.data.review.base ?? "main"}</code>
            </>
          )}
        </Show>{" "}
        · by {props.data.review.authorName} · revised {new Date(props.data.review.ts).toLocaleString()}
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
      </div>
      <p class="summary">{props.data.review.summary}</p>
      <div class={["source", { none: props.data.grouped === null }]}>
        {props.data.grouped ? "diff: " : "no diff: "}
        {props.data.source.detail}
      </div>
    </header>
  );
}

function DecisionSection(props: { section: Section; hunks: ReadonlyMap<string, HunkData>; diffed: boolean }) {
  const shared = createMemo(() => new Set(props.section.shared));
  return (
    <section class="decision" id={props.section.decision.id}>
      <h2>
        <span class="id">{props.section.decision.id}</span>
        {props.section.decision.what}
      </h2>
      <Show when={props.section.decision.userWhy}>
        {(why) => (
          <p class="why user">
            <span class="who">the person</span>
            {why()}
          </p>
        )}
      </Show>
      <Show when={props.section.decision.agentWhy}>
        {(why) => (
          <p class="why">
            <span class="who">the agent</span>
            {why()}
          </p>
        )}
      </Show>
      <Show when={props.section.decision.where.length > 0}>
        <div class="where">{props.section.decision.where.join(" · ")}</div>
      </Show>
      <Show when={props.section.unmatched.length > 0}>
        <div class="unmatched">
          no change at {props.section.unmatched.join(", ")} — the code there did not move, or the why is older than the branch
        </div>
      </Show>
      <For each={props.section.hunks}>{(id) => <Show when={props.hunks.get(id)}>{(h) => <Hunk hunk={h()} shared={shared().has(id)} />}</Show>}</For>
      <Show when={props.diffed && props.section.hunks.length === 0}>
        <p class="empty">no hunk of this diff is at its lines</p>
      </Show>
      <For each={props.section.forks}>{(f) => <Fork fork={f} />}</For>
    </section>
  );
}

function Unexplained(props: { ids: ReadonlyArray<string>; forks: ReadonlyArray<ForkData>; hunks: ReadonlyMap<string, HunkData> }) {
  return (
    <section class="decision unexplained" id="unexplained">
      <h2>not explained</h2>
      <p class="why">
        {props.ids.length === 0 ? "every hunk is claimed by a decision." : `${props.ids.length} hunk(s) no decision claims — the why does not cover them.`}
      </p>
      <For each={props.ids}>{(id) => <Show when={props.hunks.get(id)}>{(h) => <Hunk hunk={h()} shared={false} />}</Show>}</For>
      <Show when={props.forks.length > 0}>
        <p class="why loose">forks outside every decision's lines</p>
        <For each={props.forks}>{(f) => <Fork fork={f} />}</For>
      </Show>
    </section>
  );
}
