import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { ToolId } from "../data";
import { toolStates, warmTypes } from "../api";
import { diffNow } from "../diffNow";
import { lasting } from "../lasting";
import { installTool, keepTool, toolState } from "../intel";
import { enter } from "../fold";
import { ticketId } from "../ticket";
import { arrive } from "../wipe";

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
  const unseen = () => (toolState(props.tool)?.notices ?? []).filter((notice) => !seen().has(notice));
  // the tool's state, live from the instance while the banner is on the
  // page: the offer, an install seen through, the server's notices
  const live = createMemo(() => lasting(() => toolStates(props.tool)));
  createEffect(live, (tool) => {
    keepTool(tool);
  });
  // installed: its server starts now, at the commit the page shows, and
  // reads the project while the reader reads the diff
  const warmAt = createMemo(() => (toolState(props.tool)?.state === "ready" ? (diffNow.commit() ?? null) : null));
  createEffect(warmAt, (commit) => {
    if (commit) void warmTypes(ticketId, props.tool, commit).catch(() => {});
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
        {(tool) => (
          <div
            // it comes with the tool's state, after the code: it opens into place
            ref={(element) => {
              enter(element);
              arrive(element);
            }}
            class="banner"
            role="status"
          >
            <Show
              when={tool().state === "installing"}
              fallback={
                <>
                  <span>
                    {tool().error ? `Couldn't install ${tool().name}: ${tool().error}` : `${tool().language} type hints for this review? Installs ${tool().name} ${tool().version} (${tool().size}), once.`}
                    <Show when={tool().licence}>
                      {(licence) => (
                        <>
                          {" "}
                          Not open source:{" "}
                          <a href={licence().url} target="_blank" rel="noreferrer">
                            {licence().name}
                          </a>
                          .
                        </>
                      )}
                    </Show>
                  </span>
                  <button type="button" class="banner-go" onClick={() => void installTool(props.tool)}>
                    {tool().error ? "Try again" : "Install"}
                  </button>
                  <button type="button" class="banner-close" aria-label="Not now" onClick={dismiss}>
                    ×
                  </button>
                </>
              }
            >
              <span>
                Installing {tool().name} {tool().version}…
              </span>
            </Show>
          </div>
        )}
      </Show>
      <Show when={unseen().length > 0 ? toolState(props.tool) : null}>
        {(tool) => (
          <div class="banner" role="status">
            <span>
              <For each={unseen()}>{(notice) => <span class="banner-notice">{tool().name}: {notice}</span>}</For>
            </span>
            <button type="button" class="banner-close" aria-label="Got it" onClick={() => setSeen((acknowledged) => new Set([...acknowledged, ...unseen()]))}>
              ×
            </button>
          </div>
        )}
      </Show>
    </>
  );
}
