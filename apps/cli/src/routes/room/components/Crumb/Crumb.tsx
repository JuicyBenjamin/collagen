import { useAtomSet } from "@effect/atom-react";
import { Focusable } from "../../../../components/Focusable";
import { focusAtom, nearestFocusable } from "../../../../components/focus";
import { isEnter } from "../../../../components/keys";
import { theme } from "../../../../app/theme";

/** Where the tab bar sits when a page is open that is not a tab — a ticket,
 *  a transcript. Says where you are and how to get back: `‹ overview › …`.
 *  ← goes back; ↓ or enter drops into the page. */
export function Crumb({ trail, label, onBack }: { trail: ReadonlyArray<string>; label: string; onBack: () => void }) {
  const setFocus = useAtomSet(focusAtom);
  return (
    <Focusable
      id="crumb"
      flexShrink={0}
      hint="← back · ↓ into the page · 1/2 tabs · q quit"
      onKey={(key) => {
        if (key.name === "left") return onBack(), true;
        if (isEnter(key)) {
          const below = nearestFocusable("crumb", "down");
          if (below !== null) setFocus(below);
          return true;
        }
        return false;
      }}
    >
      {(focused) => (
        <text truncate wrapMode="none">
          <span fg={focused ? theme.accent : theme.dim}>{focused ? "› " : "  "}</span>
          {trail.map((t, i) => (
            <span key={i} fg={theme.dim}>
              {i === 0 ? "‹ " : ""}
              {t}
              {"  ›  "}
            </span>
          ))}
          <span fg={theme.accent}>{label}</span>
          <span fg={theme.dim}>   ·   esc back</span>
        </text>
      )}
    </Focusable>
  );
}
