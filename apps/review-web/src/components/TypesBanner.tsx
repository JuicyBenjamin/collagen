import { createSignal, onSettled, Show } from "solid-js";
import { installTool, refreshTool, tool } from "../intel";

const DISMISSED = "collagen.typesBanner.dismissed";
const remembered = (): boolean => {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
};

/** The offer, on a review with TypeScript or JavaScript in it: type hints
 *  need a pinned TypeScript, fetched once on the person's click. Gone once
 *  it is installed, or when they wave it away (remembered in this browser). */
export function TypesBanner() {
  const [dismissed, setDismissed] = createSignal(remembered());
  onSettled(() => {
    void refreshTool();
    // while an install runs, see it through
    const timer = setInterval(() => tool()?.state === "installing" && void refreshTool(), 1000);
    return () => clearInterval(timer);
  });
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      // a private window: dismissed for now
    }
  };
  return (
    <Show when={!dismissed() && tool() && tool()!.state !== "ready" ? tool() : null}>
      {(t) => (
        <div class="banner" role="status">
          <Show
            when={t().state === "installing"}
            fallback={
              <>
                <span>
                  {t().error ? `Couldn't install TypeScript: ${t().error}` : `Type hints for this review? Installs TypeScript ${t().version} (about 30 MB), once.`}
                </span>
                <button type="button" class="banner-go" onClick={() => void installTool()}>
                  {t().error ? "Try again" : "Install"}
                </button>
                <button type="button" class="banner-close" aria-label="Not now" onClick={dismiss}>
                  ×
                </button>
              </>
            }
          >
            <span>Installing TypeScript {t().version}…</span>
          </Show>
        </div>
      )}
    </Show>
  );
}
