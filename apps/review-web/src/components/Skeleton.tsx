import { For } from "solid-js";

// The review page's shape, before there is anything to put in it: the real
// parts' own markup, their words masked (.sk-w), so every line box is the one
// the part that replaces it draws — nothing moves when it arrives. Each part
// is swept away corner to corner as it is read (wipe.ts, App.tsx).

/** Masked words: as wide as the words would be, a bar where they will be. */
const words = (text: string) => <span class="sk-w">{text}</span>;

const NAV_ROWS = ["The parts that read first", "What the change is for", "Where its code goes"] as const;

/** The outline's rows. */
export function NavSkeleton() {
  return (
    <div class="sk" role="status" aria-busy="true" aria-label="Reading the review">
      <p class="nav-title">{words("Units")}</p>
      <p class="nav-viewed">{words("0 of 10 files viewed")}</p>
      <ol>
        <For each={NAV_ROWS}>
          {(row) => (
            <li>
              <a>
                <span class="nav-what">{words(row)}</span>
                <span class="count">{words("2 changes")}</span>
              </a>
            </li>
          )}
        </For>
      </ol>
    </div>
  );
}

/** The title block, the first time a review is opened (after that its
 *  last header stands in, App.tsx): where it is on, the host's line, the
 *  purpose, and the two lines beneath it most summaries take. */
export function HeaderSkeleton() {
  return (
    <header class="sk" aria-hidden="true">
      <div class="header-top">
        <p class="meta">{words("the branch into its base · by its author")}</p>
        <div class="host-bar">
          <div class="host-row">{words("0 / 10 files viewed")}</div>
        </div>
      </div>
      <h1 class="purpose">{words("What this change is for, in a few words")}</h1>
      <p class="summary">{words("What is different for whoever uses it once it lands, in a sentence or two that most often runs onto a second line.")}</p>
    </header>
  );
}

const CODE_SHAPES = ["export function readTheRows(page) {", "  const rows = page.rows;", "  return rows.map(toRow);", "}", "", "const toRow = (row) => ({", "  id: row.id,", "  name: row.name.trim(),", "});"] as const;
/** Code lines: enough to run past the bottom of a screen, so the sweep only
 *  ever trades code for code, never a placeholder's next title for code. */
const CODE_LINES = Array.from({ length: 36 }, (_, index) => CODE_SHAPES[index % CODE_SHAPES.length]!);

/** The code not read yet: the first unit's title and lines, then its code
 *  running past the screen's bottom — whatever the review holds below it is
 *  out of sight while it loads, and grows the page there when it arrives. */
export function UnitsSkeleton() {
  return (
    <div class="sk" role="status" aria-busy="true" aria-label="Reading the code">
      <section class="decision unit">
        <div class="unit-head">
          <div class="decision-head">
            <h2>{words("What the change does first")}</h2>
            <p class="decision-what">{words("the code that together achieves it")}</p>
            <p class="unit-why">
              <span class="who">{words("Why")}</span>
              <span class="chip">{words("the decision behind it")}</span>
            </p>
            <p class="unit-size">{words("4 changes in 2 files")}</p>
          </div>
        </div>
        <div class="unit-body">
          <div class="decision-main">
            <div class="hunk-group">
              <div class="hunk">
                <div class="file">
                  <span class="head path">{words("src/the/file.ts")}</span>
                  <span class="file-side">
                    <span class="whole-toggle">{words("Whole file")}</span>
                    <span class="mark-viewed">{words("Viewed")}</span>
                  </span>
                </div>
                <table>
                  <tbody>
                    <For each={CODE_LINES}>
                      {(line, row) => (
                        <tr>
                          <td class="n">{words(String(row() + 1))}</td>
                          <td class="t">{line ? words(line) : " "}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
