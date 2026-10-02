import { createMemo, For } from "solid-js";
import type { Decision, Hunk as HunkData } from "../data";
import { highlightHunk } from "../highlight";

/** One hunk: file and header, then its lines with old and new numbers, each
 *  line's code coloured by TanStack Highlight as spans of its own — never
 *  set as HTML. */
export function Hunk(props: { hunk: HunkData; alsoUnder: ReadonlyArray<Decision> }) {
  const spans = createMemo(() => highlightHunk(props.hunk));
  return (
    <div class="hunk">
      <div class="file">
        <span class="head">{props.hunk.file}</span>
        {/* the same code serves more than one decision: say which, and go there */}
        <For each={props.alsoUnder.slice(0, 1)}>
          {(d) => (
            <a class="also" href={`#${d.id}`} title={props.alsoUnder.map((x) => x.what).join("\n")}>
              also under “{d.what.length > 48 ? `${d.what.slice(0, 47)}…` : d.what}”{props.alsoUnder.length > 1 ? ` +${props.alsoUnder.length - 1}` : ""}
            </a>
          )}
        </For>
      </div>
      <div class="code">
        <table>
          <tbody>
            <For each={props.hunk.lines}>
              {(line, i) => (
                <tr class={{ add: line.kind === "+", del: line.kind === "-" }}>
                  <td class="n">{line.old ?? ""}</td>
                  <td class="n">{line.new ?? ""}</td>
                  <td class="t">
                    <span class="sign">{line.kind === " " ? " " : line.kind}</span>
                    <For each={spans()[i()] ?? []}>{(s) => (s.className ? <span class={`th-${s.className}`}>{s.value}</span> : s.value)}</For>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  );
}
