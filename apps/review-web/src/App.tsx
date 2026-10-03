import { createEffect, createMemo, createSignal, Errored, For, Loading, Show } from "solid-js";
import { NO_TITLE, toolOf, type Decision, type Hunk as HunkData, type ReviewPageData, type Unit } from "./data";
import { Fork } from "./components/Fork";
import { Hunk } from "./components/Hunk";
import { Popover } from "./components/Popover";
import { TypesBanner } from "./components/TypesBanner";
import { ticketId } from "./ticket";
import { viewed } from "./viewedNow";
import { reviewChanges, reviewData } from "./api";
import { diffNow } from "./diffNow";

// The review page: a review ticket's diff read by purpose. One section per
// unit — what it achieves, a line on what it does, the decisions that shaped
// it, then its code, each change shown once; beside it, quieter, the full why
// (how the person steered each decision, what their agent reasoned) and the
// forks in the road. Last, the changes no decision covers: "Not explained",
// itself a finding. Ids, pointers and where the diff came
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
  const decisions = createMemo(() => new Map(props.data.review.decisions.map((d) => [d.id, d])));
  // the units each decision shaped — a decision spanning units links the others
  const unitsOf = createMemo(() => {
    const m = new Map<string, Array<Unit>>();
    for (const u of props.data.grouped?.units ?? []) for (const d of u.decisions) m.set(d, [...(m.get(d) ?? []), u]);
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
      <nav aria-label={props.data.grouped ? "Units" : "Decisions"}>
        <p class="nav-title">{props.data.grouped ? "Units" : "Decisions"}</p>
        <Show when={viewed.count().files > 0}>
          <p class={["nav-viewed", { done: viewed.count().viewed === viewed.count().files }]}>
            {viewed.count().viewed} of {viewed.count().files} files viewed
          </p>
        </Show>
        <ol>
          <Show
            when={props.data.grouped}
            fallback={
              <For each={props.data.review.decisions}>
                {(d) => (
                  <li>
                    <a href={`#${d.id}`}>
                      <span class={["nav-what", { untitled: !d.title }]}>{d.title ?? NO_TITLE}</span>
                    </a>
                  </li>
                )}
              </For>
            }
          >
            {(g) => (
              <For each={g().units}>
                {(u) => (
                  <li class={{ "nav-unexplained": u.by === "unexplained" }}>
                    <a href={`#${u.id}`}>
                      <span class="nav-what">{u.title}</span>
                      <span class="count">
                        {changes(u.hunks.length)}
                        {u.unexplained.length > 0 ? ` · ${u.unexplained.length} not explained` : ""}
                      </span>
                    </a>
                  </li>
                )}
              </For>
            )}
          </Show>
          <Show when={(props.data.grouped?.outside.length ?? 0) > 0}>
            <li class="nav-unexplained">
              <a href="#outside">
                <span class="nav-what">Decisions outside the diff</span>
                <span class="count">{props.data.grouped!.outside.length}</span>
              </a>
            </li>
          </Show>
        </ol>
      </nav>

      <main>
        <Header data={props.data} />
        {/* one offer per language the review's code is in */}
        <For each={[...new Set((props.data.grouped?.hunks ?? []).map((h) => toolOf(h.file)).filter((t) => t !== null))]}>{(tool) => <TypesBanner tool={tool} />}</For>
        <Show
          when={props.data.grouped}
          fallback={
            <>
              <For each={props.data.review.decisions}>{(d) => <BareDecision decision={d} />}</For>
              <Show when={props.data.review.forks.length > 0}>
                <section class="decision">
                  <h2>Forks in the road</h2>
                  <For each={props.data.review.forks}>{(f) => <Fork fork={f} />}</For>
                </section>
              </Show>
            </>
          }
        >
          {(g) => (
            <>
              <For each={g().units}>{(u) => <UnitSection unit={u} hunks={hunks()} decisions={decisions()} unitsOf={unitsOf()} unmatched={g().unmatched} />}</For>
              <Show when={g().outside.length > 0}>
                <section class="decision" id="outside">
                  <div class="decision-head">
                    <h2>Decisions outside the diff</h2>
                    <p class="decision-what">Their code is in no change here — the why may be older than the branch, or points at nothing.</p>
                  </div>
                  <div class="decision-main" />
                  <details class="why" open={wide()}>
                    <summary>Why</summary>
                    <For each={g().outside.map((id) => decisions().get(id)).filter((d): d is Decision => d !== undefined)}>
                      {(d) => (
                        <div class="why-decision">
                          <DecisionWhy decision={d} />
                          <p class="stale" title={(g().unmatched[d.id] ?? []).join(", ")}>
                            {d.where.length === 0 ? "Points at no code." : `Points at code this diff does not change: ${d.where.join(", ")}`}
                          </p>
                        </div>
                      )}
                    </For>
                  </details>
                </section>
              </Show>
              <Show when={g().looseForks.length > 0}>
                <section class="decision">
                  <h2>Forks outside the diff</h2>
                  <div class="decision-main">
                    <For each={g().looseForks}>{(f) => <Fork fork={f} />}</For>
                  </div>
                </section>
              </Show>
            </>
          )}
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
  // the title leads — a few words, what the change is for — and the summary
  // is the line beneath it. A review filed before titles has only its
  // branch's name for a goal: its summary leads instead
  const headline = () =>
    props.data.ticket.title ?? (props.data.ticket.kind === "review" && props.data.review.summary.trim().length > 0 ? props.data.review.summary : props.data.ticket.goal);
  const beneath = () => (headline() === props.data.review.summary ? "" : props.data.review.summary.trim());
  return (
    <header>
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
      <h1 class="purpose">{headline()}</h1>
      <Show when={beneath()}>
        <p class="summary">{beneath()}</p>
      </Show>
    </header>
  );
}

/** A decision's own words: its headline, what was done, what guided it,
 *  how the person steered it and what the agent reasoned. */
function DecisionWhy(props: { decision: Decision }) {
  return (
    <>
      <p class={["why-title", { untitled: !props.decision.title }]}>{props.decision.title ?? NO_TITLE}</p>
      <p class="why-what">{props.decision.what}</p>
      {/* what told the agent to do it this way: right beside its code, so a
          skill that points the wrong way is seen where it did */}
      <Show when={props.decision.guidedBy?.length ? props.decision.guidedBy : null}>
        {(by) => (
          <p class="guided-by">
            Guided by <For each={by()}>{(s, i) => <>{i() > 0 ? ", " : ""}<code>{s}</code></>}</For>
          </p>
        )}
      </Show>
      <Show when={props.decision.userWhy}>
        {(why) => (
          <div class="why-part">
            <p class="who">The person</p>
            <p class="quote">{why()}</p>
          </div>
        )}
      </Show>
      <Show when={props.decision.agentWhy}>
        {(why) => (
          <div class="why-part">
            <p class="who">The agent</p>
            <p>{why()}</p>
          </div>
        )}
      </Show>
    </>
  );
}

/** The why beside a unit: the decisions that shaped it (one spanning other
 *  units links them), the forks that fall in it, and what no decision
 *  covers — quieter than the code, and on a narrow screen folded away. */
function Why(props: {
  unit: Unit;
  decisions: ReadonlyArray<Decision>;
  unitsOf: ReadonlyMap<string, ReadonlyArray<Unit>>;
  unmatched: Readonly<Record<string, ReadonlyArray<string>>>;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  // what no decision covers is said by the unit itself when that is all it is
  const has = () => props.decisions.length > 0 || props.unit.forks.length > 0 || (props.unit.unexplained.length > 0 && props.unit.by !== "unexplained");
  return (
    <Show when={has()}>
      <details class="why" open={props.open} onToggle={(e) => props.onToggle(e.currentTarget.open)}>
        <summary>Why in full</summary>
        <For each={props.decisions}>
          {(d) => (
            <div class="why-decision" id={whyId(props.unit, d)}>
              <DecisionWhy decision={d} />
              <Show when={(props.unitsOf.get(d.id) ?? []).filter((u) => u.id !== props.unit.id)}>
                {(others) => (
                  <Show when={others().length > 0}>
                    <p class="also-in">
                      Also shaped{" "}
                      <For each={others()}>
                        {(u, i) => (
                          <>
                            {i() > 0 ? ", " : ""}
                            <a href={`#${u.id}`}>{u.title}</a>
                          </>
                        )}
                      </For>
                    </p>
                  </Show>
                )}
              </Show>
              <Show when={props.unmatched[d.id]}>
                {(missed) => (
                  <p class="stale" title={missed().join(", ")}>
                    Also points at code this diff does not change — the why may be older than the branch.
                  </p>
                )}
              </Show>
            </div>
          )}
        </For>
        <For each={props.unit.forks}>{(f) => <Fork fork={f} />}</For>
        <Show when={props.unit.unexplained.length > 0 && props.unit.by !== "unexplained"}>
          <p class="stale">
            {changes(props.unit.unexplained.length)} here no decision covers — worth a question to the author.
          </p>
        </Show>
      </details>
    </Show>
  );
}

/** Where a decision's full why sits beside a unit — a chip in the unit's
 *  header leads there. */
const whyId = (unit: Unit, d: Decision) => `why-${unit.id}-${d.id}`;

/** A unit: what it achieves, a line on what it does, the decisions that
 *  shaped it (each a chip leading to its full why beside the code), then its
 *  code — each change in it shown once, a file's changes under one header. */
function UnitSection(props: {
  unit: Unit;
  hunks: ReadonlyMap<string, HunkData>;
  decisions: ReadonlyMap<string, Decision>;
  unitsOf: ReadonlyMap<string, ReadonlyArray<Unit>>;
  unmatched: Readonly<Record<string, ReadonlyArray<string>>>;
}) {
  const shaped = () => props.unit.decisions.map((id) => props.decisions.get(id)).filter((d): d is Decision => d !== undefined);
  const files = () => new Set(props.unit.hunks.map((id) => props.hunks.get(id)?.file)).size;
  const unexplained = () => new Set(props.unit.unexplained);
  // a unit that is a decision names it in its title already: its chips are the others
  const chips = () => shaped().filter((d) => props.unit.id !== `d-${d.id}`);
  const [open, setOpen] = createSignal(wide());
  createEffect(wide, (w) => {
    setOpen(w);
  });
  const show = (d: Decision) => {
    // folded under the title on a narrow screen: open it first, then go there
    setOpen(true);
    requestAnimationFrame(() => {
      const at = document.getElementById(whyId(props.unit, d));
      if (!at) return;
      at.scrollIntoView({ block: "nearest", behavior: "smooth" });
      at.classList.remove("flash");
      void at.offsetWidth;
      at.classList.add("flash");
    });
  };
  return (
    <section class={["decision", "unit", { unexplained: props.unit.by === "unexplained" }]} id={props.unit.id}>
      <div class="decision-head">
        <h2>{props.unit.title}</h2>
        <Show when={props.unit.what}>
          <p class="decision-what">{props.unit.what}</p>
        </Show>
        <Show when={chips().length > 0}>
          <p class="unit-why">
            <span class="who">Why</span>
            <For each={chips()}>
              {(d) => (
                <button type="button" class={["chip", { untitled: !d.title }]} onClick={() => show(d)}>
                  {d.title ?? NO_TITLE}
                </button>
              )}
            </For>
          </p>
        </Show>
        <p class="unit-size">
          {changes(props.unit.hunks.length)} in {files() === 1 ? "1 file" : `${files()} files`}
        </p>
      </div>
      <div class="decision-main">
        <For each={props.unit.hunks}>
          {(id, i) => (
            <Show when={props.hunks.get(id)}>
              {(h) => <Hunk hunk={h()} continued={i() > 0 && props.hunks.get(props.unit.hunks[i() - 1]!)?.file === h().file} unexplained={unexplained().has(id)} />}
            </Show>
          )}
        </For>
      </div>
      <Why unit={props.unit} decisions={shaped()} unitsOf={props.unitsOf} unmatched={props.unmatched} open={open()} onToggle={setOpen} />
    </section>
  );
}

/** A decision on a review read without a diff: its words, no code. */
function BareDecision(props: { decision: Decision }) {
  return (
    <section class="decision" id={props.decision.id}>
      <div class="decision-head">
        <h2 class={{ untitled: !props.decision.title }}>{props.decision.title ?? NO_TITLE}</h2>
        <p class="decision-what">{props.decision.what}</p>
      </div>
      <div class="decision-main">
        <Show when={props.decision.where.length > 0}>
          <p class="empty">{props.decision.where.join(", ")}</p>
        </Show>
      </div>
      <details class="why" open={wide()}>
        <summary>Why</summary>
        <DecisionWhy decision={props.decision} />
      </details>
    </section>
  );
}
