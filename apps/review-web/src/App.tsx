import { createEffect, createMemo, createSignal, Errored, For, Loading, Show } from "solid-js";
import { NO_TITLE, toolOf, type Decision, type Hunk as HunkData, type ReviewPageData, type Unit } from "./data";
import { Fork } from "./components/Fork";
import { Hunk } from "./components/Hunk";
import { Popover } from "./components/Popover";
import { TypesBanner } from "./components/TypesBanner";
import { ticketId } from "./ticket";
import { reading, viewed } from "./viewedNow";
import { reviewChanges, reviewData } from "./api";
import { lasting } from "./lasting";
import { hostNow } from "./hostNow";
import { HostBar } from "./components/HostBar";
import { StackRow } from "./components/StackRow";
import { DraftsBar } from "./components/DraftsBar";
import { Unplaced } from "./components/Unplaced";
import { HostActivity } from "./components/HostActivity";
import { diffNow } from "./diffNow";
import { placeWhy, whyOpening } from "./whyPanel";
import { assumedNow } from "./assumedNow";
import { AssumedMark, AssumedWhy, VerdictMark } from "./components/Assumption";

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
  // or the branch's commit in the clone changes — opened again whenever the
  // connection breaks (collagen restarted), its first value catching up
  const state = createMemo(() => lasting(() => reviewChanges(ticketId)));
  // the review on its host, read beside the data and never before it
  hostNow.start(state);
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

/** Every file of a unit marked viewed — the outline ticks it off. */
const unitViewed = (u: Unit): boolean => {
  const files = new Set(u.hunks.map((id) => id.slice(0, id.lastIndexOf("#"))));
  return files.size > 0 && [...files].every((f) => viewed.state(f) === "viewed");
};

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
  // a why guessed, not told: every decision and fork drawn knows it
  createEffect(
    () => props.data.review.assumed,
    (a) => {
      assumedNow.setAssumed(a);
    },
  );
  createEffect(
    () => (props.data.review.claimed ? props.data.review.authorName : undefined),
    (by) => {
      assumedNow.setClaimedBy(by);
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
                  <li class={{ "nav-unexplained": u.by === "unexplained", "nav-done": unitViewed(u) }}>
                    <a href={`#${u.id}`} title={unitViewed(u) ? "Every file here is viewed" : undefined}>
                      <span class="nav-what">
                        <Show when={unitViewed(u)}>
                          <span class="nav-check">✓ </span>
                        </Show>
                        {u.title}
                      </span>
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
        <HostActivity />
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
          <p>A review or comment sent from here goes to the pull request on its host, in your name. Your take on the collagen ticket still goes through your agent.</p>
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
      <div class="header-top">
      <p class="meta">
        <Show when={props.data.review.branch}>
          {(branch) => (
            <>
              <code>{branch()}</code> into <code>{props.data.review.base ?? "main"}</code> ·{" "}
            </>
          )}
        </Show>
        <Show when={props.data.review.assumed} fallback={<>by {props.data.review.authorName}</>}>
          {(a) => (
            <Show when={props.data.review.claimed} fallback={<>by {a().author}</>}>
              <>by {props.data.review.authorName}</>
            </Show>
          )}
        </Show>
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
      <HostBar />
      </div>
      <StackRow />
      <DraftsBar />
      <Unplaced />
      <h1 class="purpose">{headline()}</h1>
      <Show when={beneath()}>
        <p class="summary">{beneath()}</p>
      </Show>
      <Show when={props.data.review.assumed}>
        {(a) => {
          // the guesses not answered yet — all of them, until the code's author took it over
          const ids = () => props.data.review.decisions.filter((d) => assumedNow.isGuess(d)).map((d) => d.id);
          const said = (v: string) => props.data.review.decisions.filter((d) => d.verdict === v).length + props.data.review.forks.filter((f) => f.verdict === v).length;
          return (
            <Show
              when={props.data.review.claimed}
              fallback={
                <div class="assumed-banner" role="note">
                  <p>Assumption-based review by {props.data.review.authorName}</p>
                </div>
              }
            >
              {(c) => (
                <div class="assumed-banner claimed" role="note">
                  <p>
                    Assumption-based review by {c().guessedByName}, answered by {props.data.review.authorName}
                  </p>
                  <p class="assumed-count">
                    {said("confirmed")} confirmed · {said("corrected")} corrected · {said("wrong")} wrong{ids().length > 0 ? ` · ${ids().length} open` : ""}
                  </p>
                </div>
              )}
            </Show>
          );
        }}
      </Show>
    </header>
  );
}

/** A decision's own words: its headline, what was done, what guided it,
 *  how the person steered it and what the agent reasoned. */
function DecisionWhy(props: { decision: Decision }) {
  return (
    <>
      <Show when={assumedNow.isGuess(props.decision)} fallback={<VerdictMark verdict={props.decision.verdict} />}>
        <AssumedMark {...(props.decision.confidence ? { confidence: props.decision.confidence } : {})} />
      </Show>
      <p class={["why-title", { untitled: !props.decision.title, wrong: props.decision.verdict === "wrong" }]}>{props.decision.title ?? NO_TITLE}</p>
      <p class={["why-what", { wrong: props.decision.verdict === "wrong" }]}>{props.decision.what}</p>
      <Show when={assumedNow.isGuess(props.decision)} fallback={<ToldWhy decision={props.decision} />}>
        <AssumedWhy decision={props.decision} />
      </Show>
      <Show when={props.decision.guess}>
        {(g) => (
          <div class="why-part guessed">
            <p class="who">The AI had guessed</p>
            <p>
              {g().what}
              {g().why ? ` — ${g().why}` : ""}
            </p>
          </div>
        )}
      </Show>
    </>
  );
}

/** A told decision's why: what guided the agent, the person's words and the agent's reasons. */
function ToldWhy(props: { decision: Decision }) {
  return (
    <>
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
}) {
  return (
    <>
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
    </>
  );
}

/** Opens and folds a unit's why: a sidebar icon, and on the head's toggle a word for it too. */
function WhyToggle(props: { open: boolean; onToggle: () => void; controls: string; class: string; label?: boolean }) {
  return (
    <button
      type="button"
      class={["why-toggle", props.class, { on: props.open }]}
      aria-expanded={props.open ? "true" : "false"}
      aria-controls={props.controls}
      aria-label={props.open ? "Hide why" : "Show why"}
      title={props.open ? "Hide why" : "Show why"}
      onClick={() => props.onToggle()}
    >
      <svg width="15" height="12" viewBox="0 0 15 12" aria-hidden="true">
        <rect x="0.75" y="0.75" width="13.5" height="10.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.5" />
        <rect x="9" y="1.5" width="4.5" height="9" fill="currentColor" opacity={props.open ? "0.9" : "0.25"} />
      </svg>
      <Show when={props.label}>{props.open ? "Hide why" : "Show why"}</Show>
    </button>
  );
}

/** Is there a why to show beside a unit: decisions, forks, or — when that is
 *  not all the unit is — changes no decision covers. */
const hasWhy = (unit: Unit, decisions: ReadonlyArray<Decision>) =>
  decisions.length > 0 || unit.forks.length > 0 || (unit.unexplained.length > 0 && unit.by !== "unexplained");

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
  /** What the diff skips between one change of a file and the next in this
   *  unit: how many lines, and how many changes among them sit in another unit. */
  const skippedBefore = (above: HunkData, h: HunkData) => {
    const from = above.newStart + above.newLines;
    const elsewhere = [...props.hunks.values()].filter((o) => o.file === h.file && o.newStart >= from && o.newStart < h.newStart).length;
    return { lines: h.newStart - from, elsewhere };
  };
  // the unit's changes in runs of one file each, in order
  const runs = createMemo(() => {
    const out: Array<Array<HunkData>> = [];
    for (const id of props.unit.hunks) {
      const h = props.hunks.get(id);
      if (!h) continue;
      const last = out[out.length - 1];
      if (last && last[0]!.file === h.file) last.push(h);
      else out.push([h]);
    }
    return out;
  });
  const unexplained = () => new Set(props.unit.unexplained);
  // a unit that is a decision names it in its title already: its chips are the others
  const chips = () => shaped().filter((d) => props.unit.id !== `d-${d.id}`);
  const [open, setOpen] = createSignal(wide());
  createEffect(wide, (w) => {
    setOpen(w);
  });
  // every file here marked viewed (and not opened again to read): the reader
  // is done with this unit, so its why folds with its code — no column of reasons holding the section open.
  // Unmarking one opens it again; either can still be opened by hand.
  let wasDone = false;
  createEffect(
    () => {
      const files = [...new Set(props.unit.hunks.flatMap((id) => props.hunks.get(id)?.file ?? []))];
      return files.length > 0 && files.every((f) => reading.folded(f));
    },
    (done) => {
      if (done) setOpen(false);
      else if (wasDone) setOpen(wide());
      wasDone = done;
    },
  );
  const show = (d: Decision) => {
    // folded: open it first, then go there once it has opened
    const wait = open() ? 0 : whyOpening();
    setOpen(true);
    setTimeout(() => {
      const at = document.getElementById(whyId(props.unit, d));
      if (!at) return;
      at.scrollIntoView({ block: "nearest", behavior: "smooth" });
      at.classList.remove("flash");
      void at.offsetWidth;
      at.classList.add("flash");
    }, wait);
  };
  // the why's panel, placed as it is at first and moved on every change after
  let panel: HTMLElement | undefined;
  let inner: HTMLElement | undefined;
  let placed = false;
  createEffect(
    () => [open(), wide()] as const,
    ([o, w]) => {
      if (!panel || !inner) return;
      void placeWhy(panel, inner, o, w, !placed);
      placed = true;
    },
  );
  return (
    <section class={["decision", "unit", { unexplained: props.unit.by === "unexplained" }]} id={props.unit.id}>
      <div class="unit-head">
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
                  <button type="button" class={["chip", { untitled: !d.title, assumed: assumedNow.isGuess(d), wrong: d.verdict === "wrong" }]} onClick={() => show(d)} title={assumedNow.isGuess(d) ? "an assumption — inferred, not told" : d.verdict === "wrong" ? "a wrong guess, its author says" : undefined}>
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
        {/* a narrow window unfolds the why under the head: its toggle is here */}
        <Show when={hasWhy(props.unit, shaped())}>
          <WhyToggle open={open()} onToggle={() => setOpen(!open())} controls={`why-${props.unit.id}`} class="head-toggle" label />
        </Show>
      </div>
      <div class="unit-body">
        <div class="decision-main">
          {/* one card per file: its changes in this unit together, so its header
              stays at the top of the window through all of them */}
          <For each={runs()}>
            {(run) => (
              <div class="hunk-group">
                <For each={run}>
                  {(h, j) => <Hunk hunk={h} continued={j() > 0} skipped={j() > 0 ? skippedBefore(run[j() - 1]!, h) : undefined} unexplained={unexplained().has(h.id)} />}
                </For>
              </div>
            )}
          </For>
        </div>
        {/* a wide window keeps the why in a rail beside the code: its toggle
            on top, sticking with it down the unit, so it can be folded or
            opened from anywhere in a long one */}
        <Show when={hasWhy(props.unit, shaped())}>
          <div class="why-rail">
            <WhyToggle open={open()} onToggle={() => setOpen(!open())} controls={`why-${props.unit.id}`} class="rail-toggle" />
            <aside class="why-panel" id={`why-${props.unit.id}`} ref={(el) => (panel = el)} aria-label="Why">
              <div class="why" ref={(el) => (inner = el)}>
                <Why unit={props.unit} decisions={shaped()} unitsOf={props.unitsOf} unmatched={props.unmatched} />
              </div>
            </aside>
          </div>
        </Show>
      </div>
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
