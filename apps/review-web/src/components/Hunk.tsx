import { createMemo, createSignal, For, Show } from "solid-js";
import type { DiffLine, Hunk as HunkData, WholeFileResult } from "../data";
import { diffNow } from "../diffNow";
import { ticketId } from "../ticket";
import { wholeFile } from "../api";
import { hasNewSide, wholeHunk } from "../whole";
import { highlightHunk } from "../highlight";
import { markWord, peek, peekAt, pointAt, readyFor, wordAt, wordEnd, type Spot } from "../intel";
import { CodeLine } from "./Code";
import { Peek } from "./Peek";
import { LineComposer, LineThread } from "./LineThread";
import { hostNow } from "../hostNow";
import { viewed } from "../viewedNow";
import { sinceOf } from "../sinceNow";
import { moved, placeSince } from "../since";

/** The character a pointer is over, in a line drawn by CodeLine: the text
 *  under the pointer, and where its span starts (data-o). */
function charAt(x: number, y: number): { readonly col: number; readonly node: Node; readonly offset: number } | null {
  const pos = document.caretPositionFromPoint?.(x, y);
  const node = pos?.offsetNode ?? document.caretRangeFromPoint?.(x, y)?.startContainer;
  const offset = pos?.offset ?? document.caretRangeFromPoint?.(x, y)?.startOffset ?? 0;
  const span = node?.parentElement?.closest("[data-o]");
  if (!node || !span) return null;
  return { col: Number(span.getAttribute("data-o")) + offset, node, offset };
}

/** The band between two changes in one file, in words: what is skipped. */
const skippedText = (skip: { readonly lines: number; readonly elsewhere: number } | undefined): string => {
  if (!skip || skip.lines <= 0) return "⋯";
  const lines = `${skip.lines} ${skip.lines === 1 ? "line" : "lines"}`;
  return skip.elsewhere === 0 ? `⋯ ${lines} unchanged` : `⋯ ${lines} — ${skip.elsewhere === 1 ? "a change" : `${skip.elsewhere} changes`} among them under another unit`;
};

/** One hunk: file and header, then its code (Lines). Its header offers the
 *  file whole, and a mark as viewed. A file marked as viewed folds here and
 *  wherever else it shows; once it moves, this hunk shows only what changed
 *  in it since the commit it was viewed at — or, where nothing did, stays
 *  folded — and the whole change against the base is a click away. */
export function Hunk(props: {
  hunk: HunkData;
  /** a later change in the same file of the same unit: no header of its own,
   *  the file's is the one above it */
  continued?: boolean;
  /** what the diff skips between the change above and this one: lines, and
   *  changes among them shown under another unit */
  skipped?: { readonly lines: number; readonly elsewhere: number };
  /** no decision covers this change — worth a question to the author */
  unexplained?: boolean;
}) {
  // the file whole, on the reader's word: asked once, kept while the page is
  const [whole, setWhole] = createSignal<WholeFileResult | "loading" | null>(null);
  const [open, setOpen] = createSignal(false);
  let box: HTMLDivElement | undefined;
  const wholeShown = createMemo((): HunkData | null => {
    const w = whole();
    return open() && w && w !== "loading" && "lines" in w ? wholeHunk(props.hunk, w.lines, diffNow.addedIn(props.hunk.file)) : null;
  });
  const failed = () => {
    const w = whole();
    return open() && w && w !== "loading" && "error" in w ? w.error : null;
  };
  // opened at the change, not at the top of the file
  const toChange = () =>
    requestAnimationFrame(() => {
      const row = box?.querySelector<HTMLElement>(`tr[data-new="${props.hunk.newStart}"]`);
      if (box && row) box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 3);
    });
  const toggleWhole = async () => {
    if (open()) return setOpen(false);
    setOpen(true);
    // asked once; asked again only after it failed
    const w = whole();
    if (w === null || (w !== "loading" && "error" in w)) {
      setWhole("loading");
      try {
        const at = diffNow.commit();
        setWhole(at ? await wholeFile(ticketId, props.hunk.file, at) : { error: "the page does not know which commit its diff is" });
      } catch (e) {
        setWhole({ error: String(e) });
      }
    }
    toChange();
  };
  // read already: the file folds to its header here and wherever else it shows
  const state = () => viewed.state(props.hunk.file);

  // moved since it was viewed: what changed from the commit it was viewed at
  // to the branch now, the part of it that falls in this hunk
  const since = createMemo(() => {
    const from = state() === "changed" ? viewed.viewedAt(props.hunk.file) : undefined;
    const to = diffNow.commit();
    return from && to && from !== to ? sinceOf(props.hunk.file, from, to)() : null;
  });
  const mine = createMemo((): ReadonlyArray<HunkData> | null => {
    const r = since();
    return r && r !== "loading" && "hunks" in r ? (placeSince(diffNow.hunksOf(props.hunk.file), r.hunks).get(props.hunk.id) ?? []) : null;
  });
  const sinceFailed = () => {
    const r = since();
    return r && r !== "loading" && "error" in r ? r.error : null;
  };
  const [full, setFull] = createSignal(false);
  const sinceMode = () => !open() && !full() && mine() !== null;
  const counts = () => moved(mine() ?? []);

  return (
    <Show when={!(props.continued && state() === "viewed")}>
    <div class={["hunk", { viewed: state() === "viewed", continued: props.continued }]}>
      <div class={["file", { continued: props.continued }]}>
        {/* a later change in the file: a band saying how much unchanged code
            lies between it and the one above — the file's header stays above */}
        <span class="head">{props.continued ? skippedText(props.skipped) : props.hunk.file}</span>
        <span class="file-side">
          <Show when={mine() !== null && !open()}>
            <button type="button" class="whole-toggle" onClick={() => setFull(!full())} title="Switch between what changed since you viewed it and the whole change against the base">
              {full() ? "Since you viewed" : "Whole change"}
            </button>
          </Show>
          <Show when={!props.continued && diffNow.canReadWhole() && hasNewSide(props.hunk) && state() !== "viewed"}>
            <button type="button" class="whole-toggle" onClick={() => void toggleWhole()} title="The whole file as the branch has it, this diff's added lines marked">
              {open() ? (whole() === "loading" ? "Reading…" : "Just the change") : "Whole file"}
            </button>
          </Show>
          <Show when={!props.continued}>
          <label class={["mark-viewed", { changed: state() === "changed" }]} title="Fold this file everywhere on the page, as read; it opens again if its changes move, showing what moved">
            <input type="checkbox" checked={state() === "viewed"} onChange={() => viewed.toggle(props.hunk.file, diffNow.commit())} />
            {state() === "changed" ? "Changed since viewed" : "Viewed"}
          </label>
          </Show>
        </span>
      </div>
      <Show when={state() !== "viewed"}>
        <Show when={props.unexplained}>
          <p class="hunk-note">No decision covers this change.</p>
        </Show>
        <Show when={failed()}>{(why) => <p class="whole-failed">Could not read the whole file: {why()}</p>}</Show>
        <Show when={sinceFailed()}>{(why) => <p class="whole-failed">Could not show what changed since you viewed it: {why()} Showing the whole change.</p>}</Show>
        <Show
          when={sinceMode()}
          fallback={
            <div class={["code", { whole: wholeShown() !== null }]} ref={box}>
              {/* comments on the pull request sit under their lines; a line of
                  the diff itself takes a new one (the whole file's other lines
                  are not in the pull request's diff) */}
              <Lines hunk={wholeShown() ?? props.hunk} threads={wholeShown() === null ? "all" : "new"} talk={wholeShown() === null} />
            </div>
          }
        >
          <Show when={(mine() ?? []).length > 0} fallback={<p class="since-none">Unchanged since you viewed it.</p>}>
            <p class="since-note">
              Since you viewed it: <span class="since-add">+{counts().added}</span> <span class="since-del">−{counts().removed}</span>
            </p>
            <For each={mine() ?? []}>
              {(h) => (
                <div class="code since">
                  <Lines hunk={h} />
                </div>
              )}
            </For>
          </Show>
        </Show>
      </Show>
    </div>
    </Show>
  );
}

/** A hunk's lines with old and new numbers, each line's code coloured by
 *  TanStack Highlight as spans of its own — never set as HTML. On a file a
 *  language server reads (once it is installed), a word on an added or
 *  unchanged line answers to the pointer: rest on it for its type, click it
 *  to peek where it is declared (removed lines are not the branch's, not
 *  asked). */
function Lines(props: {
  hunk: HunkData;
  /** the pull request's line comments to show under their lines: all, the
   *  new file's only (the whole file: its old numbers are not the diff's),
   *  or none (what moved since you viewed: numbered against that commit) */
  threads?: "all" | "new" | "none";
  /** a line's + (on hover) opens a comment on it, or on a block dragged out from it */
  talk?: boolean;
}) {
  const spans = createMemo(() => highlightHunk(props.hunk));
  const asks = () => readyFor(props.hunk.file);

  /** The word under the pointer on this line, as a spot in the branch, and
   *  the range of text it covers (to mark it). */
  const wordUnder = (line: DiffLine, e: MouseEvent): { spot: Spot; range: Range | null } | null => {
    if (!asks() || line.new === undefined) return null;
    const at = charAt(e.clientX, e.clientY);
    const start = at === null ? null : wordAt(line.text, at.col);
    if (at === null || start === null) return null;
    const len = at.node.textContent?.length ?? 0;
    const range = document.createRange();
    range.setStart(at.node, Math.max(0, at.offset - (at.col - start)));
    range.setEnd(at.node, Math.min(len, at.offset + (wordEnd(line.text, start) - at.col)));
    return { spot: { file: props.hunk.file, line: line.new, col: start }, range };
  };
  const spotAt = (line: DiffLine, e: MouseEvent): Spot | null => wordUnder(line, e)?.spot ?? null;

  /** Where on the pull request's diff a line is: a removed line on the old
   *  side by its old number, any other on the new side by its new one. */
  const sideOf = (line: DiffLine): { readonly side: "LEFT" | "RIGHT"; readonly n: number } | null =>
    line.kind === "-" ? (line.old !== undefined ? { side: "LEFT", n: line.old } : null) : line.new !== undefined ? { side: "RIGHT", n: line.new } : null;
  const threadOf = (line: DiffLine) => {
    const at = sideOf(line);
    const which = props.threads ?? "none";
    return at && (which === "all" || (which === "new" && at.side === "RIGHT")) ? at : null;
  };
  const talks = () => props.talk === true && hostNow.canComment();
  // the lines picked for a comment in this hunk, first to last, while picked here
  const picked = createMemo(() => {
    const p = hostNow.pick();
    return p && p.hunk === props.hunk.id ? { first: Math.min(p.anchor, p.focus), last: Math.max(p.anchor, p.focus) } : null;
  });
  const inPick = (i: number) => {
    const p = picked();
    return p !== null && i >= p.first && i <= p.last;
  };
  /** The composer for the pick, under its last line once the drag is over. */
  const composerAt = (i: number) => {
    const p = picked();
    if (!p || p.last !== i || hostNow.dragging()) return null;
    const from = sideOf(props.hunk.lines[p.first]!);
    const to = sideOf(props.hunk.lines[p.last]!);
    if (!from || !to) return null;
    const lines = props.hunk.lines.slice(p.first, p.last + 1);
    return { from: { side: from.side, line: from.n }, to: { side: to.side, line: to.n }, suggestable: lines.every((l) => l.kind !== "-") ? lines.map((l) => l.text) : null };
  };
  /** The new file's lines from `from` to `to`, as this hunk shows them — what a suggestion replaces. */
  const codeOf = (from: number, to: number): ReadonlyArray<string> | null => {
    const got = props.hunk.lines.filter((l) => l.kind !== "-" && l.new !== undefined && l.new >= from && l.new <= to);
    return got.length === to - from + 1 ? got.map((l) => l.text) : null;
  };

  return (
    <table>
      <tbody>
        <For each={props.hunk.lines}>
          {(line, i) => (
            <>
              <tr class={{ add: line.kind === "+", del: line.kind === "-", picked: inPick(i()) }} data-new={line.new} onMouseEnter={() => hostNow.dragTo(props.hunk.id, i())}>
                <td class="n">{line.old ?? ""}</td>
                <td class="n">{line.new ?? ""}</td>
                <td
                  class={["t", { asks: asks() && line.new !== undefined }]}
                  onMouseMove={(e) => {
                    const w = wordUnder(line, e);
                    // a word is something to click: say so with the pointer and a mark
                    e.currentTarget.classList.toggle("on-word", w !== null);
                    markWord(w?.range ?? null);
                    pointAt(w?.spot ?? null, e.clientX, e.clientY);
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.classList.remove("on-word");
                    markWord(null);
                    pointAt(null, 0, 0);
                  }}
                  onClick={(e) => {
                    // a click that selected text is a selection, not a peek
                    if (getSelection()?.toString()) return;
                    const spot = spotAt(line, e);
                    if (spot) {
                      pointAt(null, 0, 0);
                      peekAt(props.hunk.id, i(), spot);
                    }
                  }}
                >
                  {/* GitHub's +: shown on hover; press and drag down (or shift-click
                      another line's) for a block of lines */}
                  <Show when={talks()}>
                    <button
                      type="button"
                      class="add-comment"
                      title="Comment on this line — drag, or shift-click another line, for several"
                      aria-label="Comment on this line"
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        e.preventDefault();
                        e.stopPropagation();
                        hostNow.startPick(props.hunk.id, i(), e.shiftKey);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      +
                    </button>
                  </Show>
                  <span class="sign">{line.kind === " " ? " " : line.kind}</span>
                  <CodeLine spans={spans()[i()] ?? []} />
                </td>
              </tr>
              <Show when={threadOf(line)}>{(at) => <LineThread file={props.hunk.file} side={at().side} line={at().n} codeOf={codeOf} />}</Show>
              <Show when={composerAt(i())}>{(c) => <LineComposer file={props.hunk.file} from={c().from} to={c().to} suggestable={c().suggestable} />}</Show>
              <Show when={peek()?.hunk === props.hunk.id && peek()?.index === i() ? peek() : null}>
                {(p) => (
                  <tr class="peek-row">
                    <td colspan={3}>
                      <Peek result={p().result} />
                    </td>
                  </tr>
                )}
              </Show>
            </>
          )}
        </For>
      </tbody>
    </table>
  );
}
