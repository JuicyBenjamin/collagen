import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { ToolId } from "../data";
import { toolStates } from "../api";
import { lasting } from "../lasting";
import { installTool, keepTool, toolState } from "../intel";

const dismissedKey = (tool: ToolId) => `collagen.typesBanner.dismissed.${tool}`;
const remembered = (tool: ToolId): boolean => {
  try {
    return localStorage.getItem(dismissedKey(tool)) === "1";
  } catch {
    return false;
  }
};

/** The offer, on a review with code in a language a server reads: type
 *  hints need that language's pinned server, fetched once on the person's
 *  click — and the offer says what it is, a licence included when it is not
 *  open source. Gone once it is installed, or when they wave it away
 *  (remembered in this browser, per language). Once installed, anything the
 *  server asked to show the person is shown here. */
export function TypesBanner(props: { tool: ToolId }) {
  const [dismissed, setDismissed] = createSignal(remembered(props.tool));
  // notices are acknowledged one by one: a new one after "Got it" still shows
  const [seen, setSeen] = createSignal<ReadonlySet<string>>(new Set());
  const unseen = () => (toolState(props.tool)?.notices ?? []).filter((n) => !seen().has(n));
  // the tool's state, live from the instance while the banner is on the
  // page: the offer, an install seen through, the server's notices
  const live = createMemo(() => lasting(() => toolStates(props.tool)));
  createEffect(live, (t) => {
    keepTool(t);
  });
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissedKey(props.tool), "1");
    } catch {
      // a private window: dismissed for now
    }
  };
  return (
    <>
      <Show when={!dismissed() && toolState(props.tool) && toolState(props.tool)!.state !== "ready" ? toolState(props.tool) : null}>
        {(t) => (
          <div class="banner" role="status">
            <Show
              when={t().state === "installing"}
              fallback={
                <>
                  <span>
                    {t().error ? `Couldn't install ${t().name}: ${t().error}` : `${t().language} type hints for this review? Installs ${t().name} ${t().version} (${t().size}), once.`}
                    <Show when={t().licence}>
                      {(l) => (
                        <>
                          {" "}
                          Not open source:{" "}
                          <a href={l().url} target="_blank" rel="noreferrer">
                            {l().name}
                          </a>
                          .
                        </>
                      )}
                    </Show>
                  </span>
                  <button type="button" class="banner-go" onClick={() => void installTool(props.tool)}>
                    {t().error ? "Try again" : "Install"}
                  </button>
                  <button type="button" class="banner-close" aria-label="Not now" onClick={dismiss}>
                    ×
                  </button>
                </>
              }
            >
              <span>
                Installing {t().name} {t().version}…
              </span>
            </Show>
          </div>
        )}
      </Show>
      <Show when={unseen().length > 0 ? toolState(props.tool) : null}>
        {(t) => (
          <div class="banner" role="status">
            <span>
              <For each={unseen()}>{(n) => <span class="banner-notice">{t().name}: {n}</span>}</For>
            </span>
            <button type="button" class="banner-close" aria-label="Got it" onClick={() => setSeen((s) => new Set([...s, ...unseen()]))}>
              ×
            </button>
          </div>
        )}
      </Show>
    </>
  );
}
