import { createEffect, createMemo, createSignal, Errored, For, Loading, Show } from "solid-js";
import { NO_TITLE, toolOf, type Decision, type Hunk as HunkData, type ReviewPageData, type ReviewPageHead, type Unit } from "./data";
import { Fork } from "./components/Fork";
import { Hunk, wholeRun } from "./components/Hunk";
import { Popover } from "./components/Popover";
import { TypesBanner } from "./components/TypesBanner";
import { ticketId } from "./ticket";
import { reading, viewed } from "./viewedNow";
import { reviewChanges, reviewData, reviewHead } from "./api";
import { lasting } from "./lasting";
import { hostNow } from "./hostNow";
import { HostBar } from "./components/HostBar";
import { StackRow } from "./components/StackRow";
import { DraftsBar } from "./components/DraftsBar";
import { Unplaced } from "./components/Unplaced";
import { HostActivity } from "./components/HostActivity";
import { diffNow } from "./diffNow";
import { keepEdges, placeWhy, whyOpening } from "./whyPanel";
import { assumedNow } from "./assumedNow";
import { AssumedMark, AssumedWhy, VerdictMark } from "./components/Assumption";
import { animateDetails } from "./fold";
import { HeaderSkeleton, NavSkeleton, UnitsSkeleton } from "./components/Skeleton";
import { entering } from "./enter";

// The review page: a review ticket's diff read by purpose. One section per
// unit — what it achieves, a line on what it does, the decisions that shaped
// it, then its code, each change shown once; beside it, quieter, the full why
// (how the person steered each decision, what their agent reasoned) and the
// forks in the road. Last, the changes no decision covers: "Not explained",
// itself a finding. Ids, pointers and where the diff came
// from are plumbing — kept out of the reader's way. Read-only: a take goes
// back through the person's agent (post-review).
//
// It builds as it loads: the review's own part (title, why) is read from the
// room and stands at once; the outline and the code, which wait on the diff,
// show their shape pending and fill in when it is read — each with a light
// entrance (enter.ts), the first time only.

async function loadHead(): Promise<ReviewPageHead> {
  const head = await reviewHead(ticketId);
  if (!head) throw new Error(`no review ticket ${ticketId} in your rooms`);
  return head;
}

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
  // The head is read on its own only until the diff is first in: after that
  // it is the data's own, so the title and the why above never show a later
  // moment than the code beneath them
  let read = false;
  const data = createMemo(() => {
    state();
    return load().then((loaded) => {
      read = true;
      return loaded;
    });
  });
  const head = createMemo((): ReviewPageHead | Promise<ReviewPageHead> => {
    if (read) return data();
    state();
    return loadHead();
  });
  return (
    <Errored fallback={(error) => <p class="failed">{String(error())}</p>}>
      <Loading
        fallback={
          <div class="wrap">
            <nav aria-label="Outline">
              <NavSkeleton />
            </nav>
            <main>
              <HeaderSkeleton />
              <UnitsSkeleton count={2} />
            </main>
          </div>
        }
      >
        <Page head={head()} data={data()} />
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
narrow.addEventListener("change", (event) => setWide(!event.matches));

/** Every file of a unit marked viewed — the outline ticks it off. */
const unitViewed = (unit: Unit): boolean => {
  const files = new Set(unit.hunks.map((id) => id.slice(0, id.lastIndexOf("#"))));
  return files.size > 0 && [...files].every((file) => viewed.state(file) === "viewed");
};

/** "2 changes" — a count in words, for the outline. */
const changes = (count: number) => (count === 1 ? "1 change" : `${count} changes`);

function Page(props: { head: ReviewPageHead; data: ReviewPageData }) {
  createEffect(
    () => props.head.ticket.title ?? props.head.ticket.goal,
    (name) => {
      document.title = `${name} — review`;
    },
  );

  // what is waiting on the diff gets its shape at once and fills in when it is read
  const waiting = () => Math.min(3, Math.max(1, props.head.review.decisions.length));
  return (
    <div class="wrap">
      <nav aria-label="Outline">
        <Loading fallback={<NavSkeleton />}>
          <Outline data={props.data} />
        </Loading>
      </nav>

      <main>
        <Header head={props.head} />
        <HostActivity />
        <Loading fallback={<UnitsSkeleton count={waiting()} />}>
          <Diff data={props.data} />
        </Loading>
      </main>
    </div>
  );
}

/** The outline, once the diff is read: its units, else the decisions alone. */
function Outline(props: { data: ReviewPageData }) {
  const enter = entering();
  return (
    <div ref={(element) => enter(element)}>
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
              {(decision) => (
                <li>
                  <a href={`#${decision.id}`}>
                    <span class={["nav-what", { untitled: !decision.title }]}>{decision.title ?? NO_TITLE}</span>
                  </a>
                </li>
              )}
            </For>
          }
        >
          {(grouped) => (
            <For each={grouped().units}>
              {(unit) => (
                <li class={{ "nav-unexplained": unit.by === "unexplained", "nav-done": unitViewed(unit) }}>
                  <a href={`#${unit.id}`} title={unitViewed(unit) ? "Every file here is viewed" : undefined}>
                    <span class="nav-what">
                      <Show when={unitViewed(unit)}>
                        <span class="nav-check">✓ </span>
                      </Show>
                      {unit.title}
                    </span>
                    <span class="count">
                      {changes(unit.hunks.length)}
                      {unit.unexplained.length > 0 ? ` · ${unit.unexplained.length} not explained` : ""}
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
    </div>
  );
}

/** Everything under the header that waits on the diff: the units with their
 *  code and why, the decisions outside it, and the page's footer. */
function Diff(props: { data: ReviewPageData }) {
  const hunks = createMemo(() => new Map<string, HunkData>((props.data.grouped?.hunks ?? []).map((hunk) => [hunk.id, hunk])));
  const decisions = createMemo(() => new Map(props.data.review.decisions.map((decision) => [decision.id, decision])));
  // the units each decision shaped — a decision spanning units links the others
  const unitsOf = createMemo(() => {
    const byDecision = new Map<string, Array<Unit>>();
    for (const unit of props.data.grouped?.units ?? []) for (const decisionId of unit.decisions) byDecision.set(decisionId, [...(byDecision.get(decisionId) ?? []), unit]);
    return byDecision;
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
  const enter = entering();
  return (
    <>
      {/* one offer per language the review's code is in */}
      <For each={[...new Set((props.data.grouped?.hunks ?? []).map((hunk) => toolOf(hunk.file)).filter((tool) => tool !== null))]}>{(tool) => <TypesBanner tool={tool} />}</For>
      <Show
        when={props.data.grouped}
        fallback={
          <>
            {/* by id: the data is read again whenever the review moves (a draft
                accepted, a guess answered), and what was folded stays folded */}
            <For each={props.data.review.decisions} keyed={(decision) => decision.id}>
              {(decision, index) => <BareDecision decision={decision()} why={props.data.source.detail} enter={(element) => enter(element, index())} />}
            </For>
            <Show when={props.data.review.forks.length > 0}>
              <section class="decision">
                <div class="decision-head">
                  <h2>Forks in the road</h2>
                </div>
                <div class="decision-main" />
                <details class="why" open={wide()} ref={animateDetails}>
                  <summary>Why</summary>
                  <div>
                    <For each={props.data.review.forks}>{(fork) => <Fork fork={fork} />}</For>
                  </div>
                </details>
              </section>
            </Show>
          </>
        }
      >
        {(grouped) => (
          <>
            {/* by id, so a unit's folded why stays folded when the data is read again */}
            <For each={grouped().units} keyed={(unit) => unit.id}>
              {(unit, index) => <UnitSection unit={unit()} hunks={hunks()} decisions={decisions()} unitsOf={unitsOf()} unmatched={grouped().unmatched} enter={(element) => enter(element, index())} />}
            </For>
            <Show when={grouped().outside.length > 0}>
              <section class="decision" id="outside">
                <div class="decision-head">
                  <h2>Decisions outside the diff</h2>
                  <p class="decision-what">Their code is in no change here — the why may be older than the branch, or points at nothing.</p>
                </div>
                <div class="decision-main" />
                <details class="why" open={wide()} ref={animateDetails}>
                  <summary>Why</summary>
                  <div>
                    <For each={grouped().outside.map((id) => decisions().get(id)).filter((decision): decision is Decision => decision !== undefined)}>
                      {(decision) => (
                        <div class="why-decision">
                          <DecisionWhy decision={decision} />
                          <p class="stale" title={(grouped().unmatched[decision.id] ?? []).join(", ")}>
                            {decision.where.length === 0 ? "Points at no code." : `Points at code this diff does not change: ${decision.where.join(", ")}`}
                          </p>
                        </div>
                      )}
                    </For>
                  </div>
                </details>
              </section>
            </Show>
            <Show when={grouped().looseForks.length > 0}>
              <section class="decision">
                <div class="decision-head">
                  <h2>Forks outside the diff</h2>
                </div>
                <div class="decision-main" />
                <details class="why" open={wide()} ref={animateDetails}>
                  <summary>Why</summary>
                  <div>
                    <For each={grouped().looseForks}>{(fork) => <Fork fork={fork} />}</For>
                  </div>
                </details>
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
              ? "Diff read from the host, not your clone."
              : `No diff: ${props.data.source.detail}`}
        </p>
      </footer>
    </>
  );
}

function Header(props: { head: ReviewPageHead }) {
  // the title leads — a few words, what the change is for — and the summary
  // is the line beneath it. A review filed before titles has only its
  // branch's name for a goal: its summary leads instead
  const headline = () =>
    props.head.ticket.title ?? (props.head.ticket.kind === "review" && props.head.review.summary.trim().length > 0 ? props.head.review.summary : props.head.ticket.goal);
  const beneath = () => (headline() === props.head.review.summary ? "" : props.head.review.summary.trim());
  const enter = entering();
  return (
    <header ref={(element) => enter(element)}>
      <div class="header-top">
      <p class="meta">
        <Show when={props.head.review.branch}>
          {(branch) => (
            <>
              <code>{branch()}</code> into <code>{props.head.review.base ?? "main"}</code> ·{" "}
            </>
          )}
        </Show>
        <Show when={props.head.review.assumed} fallback={<>by {props.head.review.authorName}</>}>
          {(assumed) => (
            <Show when={props.head.review.claimed} fallback={<>by {assumed().author}</>}>
              <>by {props.head.review.authorName}</>
            </Show>
          )}
        </Show>
        <For each={props.head.links}>
          {(link) => (
            <>
              {" · "}
              <a href={link.url} target="_blank" rel="noreferrer">
                {link.label}
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
      <Show when={props.head.review.assumed}>
        {(_assumed) => {
          // the guesses not answered yet — all of them, until the code's author took it over
          const ids = () => props.head.review.decisions.filter((decision) => assumedNow.isGuess(decision)).map((decision) => decision.id);
          const said = (verdict: string) => props.head.review.decisions.filter((decision) => decision.verdict === verdict).length + props.head.review.forks.filter((fork) => fork.verdict === verdict).length;
          return (
            <Show
              when={props.head.review.claimed}
              fallback={
                <div class="assumed-banner" role="note">
                  <p>Assumption-based review by {props.head.review.authorName}</p>
                </div>
              }
            >
              {(claimed) => (
                <div class="assumed-banner claimed" role="note">
                  <p>
                    Assumption-based review by {claimed().guessedByName}, answered by {props.head.review.authorName}
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
        {(guess) => (
          <div class="why-part guessed">
            <p class="who">The AI had guessed</p>
            <p>
              {guess().what}
              {guess().why ? ` — ${guess().why}` : ""}
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
            Guided by <For each={by()}>{(skill, index) => <>{index() > 0 ? ", " : ""}<code>{skill}</code></>}</For>
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
          {(decision) => (
            <div class="why-decision" id={whyId(props.unit, decision)}>
              <DecisionWhy decision={decision} />
              <Show when={(props.unitsOf.get(decision.id) ?? []).filter((unit) => unit.id !== props.unit.id)}>
                {(others) => (
                  <Show when={others().length > 0}>
                    <p class="also-in">
                      Also shaped{" "}
                      <For each={others()}>
                        {(unit, index) => (
                          <>
                            {index() > 0 ? ", " : ""}
                            <a href={`#${unit.id}`}>{unit.title}</a>
                          </>
                        )}
                      </For>
                    </p>
                  </Show>
                )}
              </Show>
              <Show when={props.unmatched[decision.id]}>
                {(missed) => (
                  <p class="stale" title={missed().join(", ")}>
                    Also points at code this diff does not change — the why may be older than the branch.
                  </p>
                )}
              </Show>
            </div>
          )}
        </For>
        <For each={props.unit.forks}>{(fork) => <Fork fork={fork} />}</For>
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
const whyId = (unit: Unit, decision: Decision) => `why-${unit.id}-${decision.id}`;

/** A unit: what it achieves, a line on what it does, the decisions that
 *  shaped it (each a chip leading to its full why beside the code), then its
 *  code — each change in it shown once, a file's changes under one header. */
function UnitSection(props: {
  unit: Unit;
  hunks: ReadonlyMap<string, HunkData>;
  decisions: ReadonlyMap<string, Decision>;
  unitsOf: ReadonlyMap<string, ReadonlyArray<Unit>>;
  unmatched: Readonly<Record<string, ReadonlyArray<string>>>;
  enter: (element: HTMLElement) => void;
}) {
  const shaped = () => props.unit.decisions.map((id) => props.decisions.get(id)).filter((decision): decision is Decision => decision !== undefined);
  const files = () => new Set(props.unit.hunks.map((id) => props.hunks.get(id)?.file)).size;
  /** What the diff skips between one change of a file and the next in this
   *  unit: how many lines, and how many changes among them sit in another unit. */
  const skippedBefore = (above: HunkData, hunk: HunkData) => {
    const from = above.newStart + above.newLines;
    const elsewhere = [...props.hunks.values()].filter((other) => other.file === hunk.file && other.newStart >= from && other.newStart < hunk.newStart).length;
    return { lines: hunk.newStart - from, elsewhere };
  };
  // the unit's changes in runs of one file each, in order
  const runs = createMemo(() => {
    const out: Array<Array<HunkData>> = [];
    for (const id of props.unit.hunks) {
      const hunk = props.hunks.get(id);
      if (!hunk) continue;
      const last = out[out.length - 1];
      if (last && last[0]!.file === hunk.file) last.push(hunk);
      else out.push([hunk]);
    }
    return out;
  });
  const unexplained = () => new Set(props.unit.unexplained);
  // a unit that is a decision names it in its title already: its chips are the others
  const chips = () => shaped().filter((decision) => props.unit.id !== `d-${decision.id}`);
  const [open, setOpen] = createSignal(wide());
  createEffect(wide, (isWide) => {
    setOpen(isWide);
  });
  // every file here marked viewed (and not opened again to read): the reader
  // is done with this unit, so its why folds with its code — no column of reasons holding the section open.
  // Unmarking one opens it again; either can still be opened by hand.
  let wasDone = false;
  createEffect(
    () => {
      const files = [...new Set(props.unit.hunks.flatMap((id) => props.hunks.get(id)?.file ?? []))];
      return files.length > 0 && files.every((file) => reading.folded(file));
    },
    (done) => {
      if (done) setOpen(false);
      else if (wasDone) setOpen(wide());
      wasDone = done;
    },
  );
  const show = (decision: Decision) => {
    // folded: open it first, then go there once it has opened
    const wait = open() ? 0 : whyOpening();
    setOpen(true);
    setTimeout(() => {
      const at = document.getElementById(whyId(props.unit, decision));
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
    ([isOpen, isWide]) => {
      if (!panel || !inner) return;
      void placeWhy(panel, inner, isOpen, isWide, !placed);
      placed = true;
    },
  );
  return (
    <section class={["decision", "unit", { unexplained: props.unit.by === "unexplained" }]} id={props.unit.id} ref={(element) => props.enter(element)}>
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
                {(decision) => (
                  <button type="button" class={["chip", { untitled: !decision.title, assumed: assumedNow.isGuess(decision), wrong: decision.verdict === "wrong" }]} onClick={() => show(decision)} title={assumedNow.isGuess(decision) ? "an assumption — inferred, not told" : decision.verdict === "wrong" ? "a wrong guess, its author says" : undefined}>
                    {decision.title ?? NO_TITLE}
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
            {(run) => {
              const whole = wholeRun(run);
              return (
                <div class="hunk-group">
                  <For each={run}>
                    {(hunk, index) => <Hunk hunk={hunk} whole={whole} continued={index() > 0} skipped={index() > 0 ? skippedBefore(run[index() - 1]!, hunk) : undefined} unexplained={unexplained().has(hunk.id)} />}
                  </For>
                </div>
              );
            }}
          </For>
        </div>
        {/* a wide window keeps the why in a rail beside the code: its toggle
            on top, sticking with it down the unit, so it can be folded or
            opened from anywhere in a long one */}
        <Show when={hasWhy(props.unit, shaped())}>
          <div class="why-rail">
            <WhyToggle open={open()} onToggle={() => setOpen(!open())} controls={`why-${props.unit.id}`} class="rail-toggle" />
            <aside
              class="why-panel"
              id={`why-${props.unit.id}`}
              ref={(element) => {
                panel = element;
                keepEdges(element);
              }}
              aria-label="Why"
            >
              <div class="why" ref={(element) => (inner = element)}>
                <Why unit={props.unit} decisions={shaped()} unitsOf={props.unitsOf} unmatched={props.unmatched} />
              </div>
            </aside>
          </div>
        </Show>
      </div>
    </section>
  );
}

/** A decision on a review read without a diff: its words, and in place of
 *  its code why there is none — never an empty block. */
function BareDecision(props: { decision: Decision; why: string; enter: (element: HTMLElement) => void }) {
  return (
    <section class="decision" id={props.decision.id} ref={(element) => props.enter(element)}>
      <div class="decision-head">
        <h2 class={{ untitled: !props.decision.title }}>{props.decision.title ?? NO_TITLE}</h2>
        <p class="decision-what">{props.decision.what}</p>
      </div>
      <div class="decision-main">
        <div class="no-code">
          <p class="no-code-why">No code: {props.why}</p>
          <Show when={props.decision.where.length > 0}>
            <p class="empty">{props.decision.where.join(", ")}</p>
          </Show>
        </div>
      </div>
      <details class="why" open={wide()} ref={animateDetails}>
        <summary>Why</summary>
        <div>
          <DecisionWhy decision={props.decision} />
        </div>
      </details>
    </section>
  );
}
