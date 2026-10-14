import { createSignal } from "solid-js";

/** Below this width the why folds under the title instead of sitting beside
 *  the code — the code keeps the room (styles.css says the same). */
const NARROW = "(max-width: 1320px)";

// wide enough to sit beside the code: open; folded otherwise — and it
// follows the window when it is resized across the line
const narrow = matchMedia(NARROW);
const [wideNow, setWide] = createSignal(!narrow.matches);
narrow.addEventListener("change", (event) => setWide(!event.matches));

/** Is the window wide enough for the why beside the code. */
export const wide = wideNow;
