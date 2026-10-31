import { createSignal } from "solid-js";
import type { PageSettings } from "./data";
import { lasting } from "./lasting";
import { overSocket } from "./liveSocket";

// The person's switches a page wears, live: set on the TUI's settings page
// or by their agent (set-settings), every open page follows. Until collagen
// answers, the defaults.

const [settings, setSettings] = createSignal<PageSettings>({ progressBar: true });

export const settingsNow = {
  /** Made once, before any page renders. */
  start(): void {
    void (async () => {
      for await (const kept of lasting(() => overSocket("settings", ""))) setSettings(kept);
    })();
  },
  settings,
};
