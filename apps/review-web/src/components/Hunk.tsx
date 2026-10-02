import { createMemo, For } from "solid-js";
import type { Hunk as HunkData } from "../data";
import { highlightHunk } from "../highlight";

/** One hunk: file and header, then its lines with old and new numbers, each
 *  line's code coloured by TanStack Highlight as spans of its own — never
 *  set as HTML. */
export function Hunk(props: { hunk: HunkData; shared: boolean }) {
  const spans = createMemo(() => highlightHunk(props.hunk));
  return (
    <div class="hunk">
      <div class="file">
        <span class="head">
          {props.hunk.file} {props.hunk.header.replace(/^@@[^@]*@@/, "").trim()}
        </span>
        {props.shared ? (
          <span class="badge" title="another decision claims this hunk too">
            shared
          </span>
        ) : null}
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
