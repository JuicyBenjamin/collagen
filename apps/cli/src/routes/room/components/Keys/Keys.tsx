import { useAtomValue } from "@effect/atom-react";
import { captureAtom, focusAtom, hintsAtom } from "../../../../components/focus";
import { theme } from "../../../../app/theme";

/** The room panel's own footer: what the keys do in the hovered section.
 *  Hints are "key action · key action" strings registered by the sections
 *  themselves; the first word of each part is the key and gets highlighted. */
export function Keys() {
  const focus = useAtomValue(focusAtom);
  const captured = useAtomValue(captureAtom);
  const hints = useAtomValue(hintsAtom);
  const hint = captured ?? hints[focus] ?? "esc back to tabs";

  return (
    <box marginTop={1} flexShrink={0}>
      <text truncate wrapMode="none">
        {hint.split(" · ").map((part, index) => {
          const [key, ...rest] = part.split(" ");
          return (
            <span key={index}>
              {index > 0 ? <span fg={theme.dim}>  ·  </span> : null}
              <span fg={theme.accent}>{key}</span>
              {rest.length > 0 ? <span fg={theme.dim}> {rest.join(" ")}</span> : null}
            </span>
          );
        })}
      </text>
    </box>
  );
}
