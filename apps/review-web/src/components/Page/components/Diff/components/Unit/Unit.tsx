import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { NO_TITLE, type Decision, type Hunk as HunkData, type Unit as UnitData } from "~/data";
import { assumedNow } from "~/assumedNow";
import { Masked } from "~/components/Masked";
import { diffNow } from "~/diffNow";
import { animateDetails, holdInPlace } from "~/fold";
import { hostNow } from "~/hostNow";
import { reading, viewed } from "~/viewedNow";
import { wide } from "~/wide";
import { keepEdges, placeWhy, whyOpening } from "~/whyPanel";
import { Run } from "./components/Run";
import { Why } from "./components/Why";
import { WhyToggle } from "./components/WhyToggle";

/** A unit: what it achieves, a line on what it does, the decisions that
 *  shaped it (each a chip leading to its full why beside the code), then its
 *  code — each change in it shown once, a file's changes under one header.
 *  A group of repeated uses shows one use, folds the others that match it,
 *  marks them viewed together, and shows a use that differs in full. */
export function Unit(props: {
  unit: UnitData;
  /** for a group of uses: the unit whose change it applies */
  of: UnitData | undefined;
  hunks: ReadonlyMap<string, HunkData>;
  decisions: ReadonlyMap<string, Decision>;
  unitsOf: ReadonlyMap<string, ReadonlyArray<UnitData>>;
  unmatched: Readonly<Record<string, ReadonlyArray<string>>>;
}) {
  const shaped = () =>
    props.unit.decisions
      .map((id) => props.decisions.get(id))
      .filter((decision): decision is Decision => decision !== undefined);
  const files = () => new Set(props.unit.hunks.map((id) => props.hunks.get(id)?.file)).size;
  const changes = (count: number) => (count === 1 ? "1 change" : `${count} changes`);
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
  // a group of uses: the files that match each other, and those that do not;
  // of the matching rest, one with something said on it stays in sight
  const same = () => runs().filter((run) => !props.unit.uses?.differs.includes(run[0]!.file));
  const apart = () => runs().filter((run) => props.unit.uses?.differs.includes(run[0]!.file));
  const talked = () => same().slice(1).filter((run) => hostNow.talkIn(run[0]!.file));
  const folded = () => same().slice(1).filter((run) => !hostNow.talkIn(run[0]!.file));
  const unread = () => same().map((run) => run[0]!.file).filter((file) => viewed.state(file) !== "viewed");
  const markSame = (event: MouseEvent & { currentTarget: HTMLButtonElement }) => {
    // the button goes once all are marked: the line it sits on holds its place
    void holdInPlace(event.currentTarget.parentElement ?? undefined);
    for (const file of unread()) {
      viewed.mark(file, diffNow.commit());
      reading.marked(file);
    }
  };
  /** A group of uses, counted: its files, and those that differ. */
  const usesCount = (differs: ReadonlyArray<string>) => {
    const count = new Set(props.unit.hunks.map((id) => id.slice(0, id.lastIndexOf("#")))).size;
    return `${count === 1 ? "1 use" : `${count} uses`}${differs.length > 0 ? ` · ${differs.length} ${differs.length === 1 ? "differs" : "differ"}` : ""}`;
  };
  // a unit that is a decision names it in its title already: its chips are the others
  const chips = () => shaped().filter((decision) => props.unit.id !== `d-${decision.id}`);
  // is there a why to show beside it: decisions, forks, or — when that is
  // not all the unit is — changes no decision covers
  const hasWhy = () =>
    shaped().length > 0 ||
    props.unit.forks.length > 0 ||
    (props.unit.unexplained.length > 0 && props.unit.by !== "unexplained");
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
      const at = document.getElementById(`why-${props.unit.id}-${decision.id}`);
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
    <section
      class={["decision", "unit", { unexplained: props.unit.by === "unexplained" }]}
      id={props.unit.id}
    >
      <div class="unit-head">
        <div class="decision-head">
          <h2>{props.unit.title}</h2>
          <Show when={props.unit.what}>
            <p class="decision-what">{props.unit.what}</p>
          </Show>
          <Show when={props.of}>
            {(of) => (
              <p class="uses-of">
                Uses of <a href={`#${of().id}`}>{of().title}</a>
              </p>
            )}
          </Show>
          <Show when={chips().length > 0}>
            <p class="unit-why">
              <span class="who">Why</span>
              <For each={chips()}>
                {(decision) => (
                  <button
                    type="button"
                    class={[
                      "chip",
                      {
                        untitled: !decision.title,
                        assumed: assumedNow.isGuess(decision),
                        wrong: decision.verdict === "wrong",
                      },
                    ]}
                    onClick={() => show(decision)}
                    title={
                      assumedNow.isGuess(decision)
                        ? "an assumption — inferred, not told"
                        : decision.verdict === "wrong"
                          ? "a wrong guess, its author says"
                          : undefined
                    }
                  >
                    {decision.title ?? NO_TITLE}
                  </button>
                )}
              </For>
            </p>
          </Show>
          <Show
            when={props.unit.uses}
            fallback={
              <p class="unit-size">
                {changes(props.unit.hunks.length)} in {files() === 1 ? "1 file" : `${files()} files`}
              </p>
            }
          >
            {(uses) => (
              <p class="unit-size">
                {usesCount(uses().differs)}
                <Show when={unread().length > 0}>
                  <button type="button" class="mark-uses" onClick={markSame}>
                    Mark {unread().length} viewed
                  </button>
                </Show>
              </p>
            )}
          </Show>
        </div>
        {/* a narrow window unfolds the why under the head: its toggle is here */}
        <Show when={hasWhy()}>
          <WhyToggle
            open={open()}
            onToggle={() => setOpen(!open())}
            controls={`why-${props.unit.id}`}
            class="head-toggle"
            label
          />
        </Show>
      </div>
      <div class="unit-body">
        <div class="decision-main">
          {/* one card per file: its changes in this unit together, so its header
              stays at the top of the window through all of them */}
          <Show when={props.unit.uses} fallback={<For each={runs()}>{(run) => <Run run={run} hunks={props.hunks} unexplained={unexplained()} />}</For>}>
            {/* one use read, the matching rest folded under it, a use that
                differs shown whole — a wrong grouping must not hide it */}
            <Show when={same()[0]}>{(first) => <Run run={first()} hunks={props.hunks} unexplained={unexplained()} />}</Show>
            <For each={talked()}>{(run) => <Run run={run} hunks={props.hunks} unexplained={unexplained()} />}</For>
            <Show when={folded().length > 0}>
              <details class="uses-rest" ref={animateDetails}>
                <summary>{folded().length} more, the same</summary>
                <div>
                  <For each={folded()}>{(run) => <Run run={run} hunks={props.hunks} unexplained={unexplained()} />}</For>
                </div>
              </details>
            </Show>
            <For each={apart()}>
              {(run) => (
                <>
                  <p class="differs">Differs from the rest</p>
                  <Run run={run} hunks={props.hunks} unexplained={unexplained()} />
                </>
              )}
            </For>
          </Show>
        </div>
        {/* a wide window keeps the why in a rail beside the code: its toggle
            on top, sticking with it down the unit, so it can be folded or
            opened from anywhere in a long one */}
        <Show when={hasWhy()}>
          <div class="why-rail">
            <WhyToggle
              open={open()}
              onToggle={() => setOpen(!open())}
              controls={`why-${props.unit.id}`}
              class="rail-toggle"
            />
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
                <Why
                  unit={props.unit}
                  decisions={shaped()}
                  unitsOf={props.unitsOf}
                  unmatched={props.unmatched}
                />
              </div>
            </aside>
          </div>
        </Show>
      </div>
    </section>
  );
}

const CODE_SHAPES = [
  "export function readTheRows(page) {",
  "  const rows = page.rows;",
  "  return rows.map(toRow);",
  "}",
  "",
  "const toRow = (row) => ({",
  "  id: row.id,",
  "  name: row.name.trim(),",
  "});",
] as const;
/** Code lines: about a screen of them, as most units' first file runs. */
const CODE_LINES = Array.from(
  { length: 20 },
  (_, index) => CODE_SHAPES[index % CODE_SHAPES.length]!,
);

/** A unit before the diff is read: its title and lines, the why's chip, a
 *  card of code with its file's header, and beside it the why's column. */
Unit.Skeleton = function Skeleton() {
  return (
    <div class="sk" role="status" aria-busy="true" aria-label="Reading the code">
      <section class="decision unit">
        <div class="unit-head">
          <div class="decision-head">
            <h2>
              <Masked>What the change does first</Masked>
            </h2>
            <p class="decision-what">
              <Masked>the code that together achieves it</Masked>
            </p>
            <p class="unit-why">
              <span class="who">
                <Masked>Why</Masked>
              </span>
              <span class="chip">
                <Masked>the decision behind it</Masked>
              </span>
            </p>
            <p class="unit-size">
              <Masked>4 changes in 2 files</Masked>
            </p>
          </div>
        </div>
        <div class="unit-body">
          <div class="decision-main">
            <div class="hunk-group">
              <div class="hunk">
                <div class="file">
                  <span class="head path">
                    <Masked>src/the/file.ts</Masked>
                  </span>
                  <span class="file-side">
                    <span class="whole-toggle">
                      <Masked>Whole file</Masked>
                    </span>
                    <span class="mark-viewed">
                      <Masked>Viewed</Masked>
                    </span>
                  </span>
                </div>
                <table>
                  <tbody>
                    <For each={CODE_LINES}>
                      {(line, row) => (
                        <tr>
                          <td class="n">
                            <Masked>{String(row() + 1)}</Masked>
                          </td>
                          <td class="t">{line ? <Masked>{line}</Masked> : " "}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          {/* the why beside the code: its own column, not part of the code's block */}
          <div class="why-rail">
            <span class="why-toggle rail-toggle sk-button">
              <span class="sk-icon" />
            </span>
            <aside class="why-panel">
              <div class="why">
                <p class="why-title">
                  <Masked>What the decision achieves</Masked>
                </p>
                <p class="why-what">
                  <Masked>what was done, in a line or so</Masked>
                </p>
                <div class="why-part">
                  <p class="who">
                    <Masked>The person</Masked>
                  </p>
                  <p>
                    <Masked>their words for it, a sentence or two that runs over a few lines of the column</Masked>
                  </p>
                </div>
                <div class="why-part">
                  <p class="who">
                    <Masked>The agent</Masked>
                  </p>
                  <p>
                    <Masked>its reason for the shape it took, a few lines long in the narrow column</Masked>
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </div>
  );
};
