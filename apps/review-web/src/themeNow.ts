import { createSignal } from "solid-js";
import { saveThemes } from "./api";
import { lasting } from "./lasting";
import { overSocket } from "./liveSocket";
import { applyTheme, cacheThemes, cachedThemes, heldBeforeCollagen } from "./theme";
import type { PageThemes } from "./themeData";

// The theme every page wears, as one: shown from this browser's copy at
// once, then collagen's, live — a change made on any page or by the
// person's agent (set-theme) shows on every open page, whether it has a
// switch on screen or not. The switch (ThemePicker) reads and changes it here.

const [themes, setThemes] = createSignal<PageThemes>(cachedThemes());

const show = (next: PageThemes) => {
  setThemes(next);
  applyTheme(next);
  cacheThemes(next);
};

export const themeNow = {
  /** Made once, before any page renders: the theme on show, then collagen's as it moves. */
  start(): void {
    applyTheme(themes());
    void (async () => {
      for await (const kept of lasting(() => overSocket("themes", ""))) {
        // collagen keeps none yet: this browser's (an older page's too) become collagen's
        if (kept === null) {
          const held = themes();
          if (heldBeforeCollagen() || held.saved.length > 0 || held.chosen !== "") void saveThemes(held).catch(() => undefined);
        } else show(kept);
      }
    })();
  },
  themes,
  /** Shown now, and kept by collagen, which tells every page. */
  commit(next: PageThemes): void {
    show(next);
    void saveThemes(next).catch(() => undefined);
  },
};
