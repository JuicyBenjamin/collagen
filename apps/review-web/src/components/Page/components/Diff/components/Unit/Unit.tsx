import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { NO_TITLE, type Decision, type Hunk as HunkData, type Unit as UnitData } from "~/data";
import { assumedNow } from "~/assumedNow";
import { Masked } from "~/components/Masked";
import { reading } from "~/viewedNow";
import { wide } from "~/wide";
import { keepEdges, placeWhy, whyOpening } from "~/whyPanel";
import { Hunk, wholeRun } from "./components/Hunk";
import { Why } from "./components/Why";
import { WhyToggle } from "./components/WhyToggle";

/** A unit: what it achieves, a line on what it does, the decisions that
 *  shaped it (each a chip leading to its full why beside the code), then its
 *  code — each change in it shown once, a file's changes under one header. */
export function Unit(props: {
  unit: UnitData;
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
  /** What the diff skips between one change of a file and the next in this
   *  unit: how many lines, and how many changes among them sit in another unit. */
  const skippedBefore = (above: HunkData, hunk: HunkData) => {
    const from = above.newStart + above.newLines;
    const elsewhere = [...props.hunks.values()].filter(
      (other) =>
        other.file === hunk.file && other.newStart >= from && other.newStart < hunk.newStart,
    ).length;
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
          <p class="unit-size">
            {changes(props.unit.hunks.length)} in {files() === 1 ? "1 file" : `${files()} files`}
          </p>
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
          <For each={runs()}>
            {(run) => {
              const whole = wholeRun(run);
              return (
                <div class="hunk-group">
                  <For each={run}>
                    {(hunk, index) => (
                      <Hunk
                        hunk={hunk}
                        whole={whole}
                        continued={index() > 0}
                        skipped={index() > 0 ? skippedBefore(run[index() - 1]!, hunk) : undefined}
                        unexplained={unexplained().has(hunk.id)}
                      />
                    )}
                  </For>
                </div>
              );
            }}
          </For>
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
