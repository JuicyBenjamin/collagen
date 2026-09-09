import { useAtomSet } from "@effect/atom-react";
import { Focusable } from "../../../../components/Focusable";
import { focusAtom, nearestFocusable } from "../../../../components/focus";
import { isEnter } from "../../../../components/keys";
import { theme } from "../../../../app/theme";
import { useRouter } from "../../../../app/router";

/** Where the tab bar sits when a page is open that is not a tab — a ticket.
 *  Says where you are and how to get back: `‹ overview › ticket …`. ← or enter
 *  goes back to the list; ↓ drops into the page. */
export function Crumb({ label }: { label: string }) {
  const { navigate } = useRouter();
  const setFocus = useAtomSet(focusAtom);
  const back = () => {
    navigate("room/overview");
    setFocus("tickets");
  };
  return (
    <Focusable
      id="crumb"
      hint="← back to the list · ↓ into the page · 1/2 tabs · q quit"
      onKey={(key) => {
        if (key.name === "left") return back(), true;
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
          <span fg={theme.dim}>‹ overview</span>
          <span fg={theme.dim}>  ›  </span>
          <span fg={theme.accent}>{label}</span>
          <span fg={theme.dim}>   ·   esc back</span>
        </text>
      )}
    </Focusable>
  );
}
