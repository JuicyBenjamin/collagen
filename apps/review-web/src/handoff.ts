import { ticketId } from "./ticket";

// One tab per review, on any system. Where the cli cannot bring an open tab
// forward (anything but macOS, or a browser it cannot script), `o` opens a
// new one marked ?take: the new page asks the pages already showing this
// review for where their reader was, and they hand it over and close
// themselves. A browser lets a page close itself only while its history is
// that one page — so the page's own links move through it without adding
// entries. A close the browser refuses leaves two tabs, as before.

const TAKE = "take";

const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(`collagen-review:${ticketId}`);
const me = crypto.randomUUID();

type Message = { readonly kind: "take"; readonly from: string } | { readonly kind: "where"; readonly to: string; readonly scrollY: number; readonly hash: string };

/** Was this tab opened to take over from another? Asked once, at load. */
const taking = new URLSearchParams(location.search).has(TAKE);

/** Scroll to `position` once the page is tall enough to have it — the data comes
 *  in after the handover, so wait for it, but not for ever. */
function scrollWhenThere(position: number) {
  const until = Date.now() + 3_000;
  const step = () => {
    if (document.documentElement.scrollHeight >= position + innerHeight || Date.now() > until) scrollTo({ top: position, behavior: "instant" });
    else requestAnimationFrame(step);
  };
  step();
}

/** In-page links jump without a history entry, so the page stays closable
 *  (and back leaves the review rather than walking its anchors). */
function linksInPlace() {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.("a[href^='#']");
    const id = link?.getAttribute("href")?.slice(1);
    if (!id) return;
    event.preventDefault();
    history.replaceState(history.state, "", `#${id}`);
    document.getElementById(decodeURIComponent(id))?.scrollIntoView({ behavior: "instant" });
  });
}

export function startHandoff() {
  linksInPlace();
  if (taking) {
    // the marker has done its work: the url goes back to the plain one
    const url = new URL(location.href);
    url.searchParams.delete(TAKE);
    history.replaceState(history.state, "", url);
  }
  if (!channel) return;
  channel.addEventListener("message", (event: MessageEvent<Message>) => {
    const message = event.data;
    if (message.kind === "take" && message.from !== me) {
      channel.postMessage({ kind: "where", to: message.from, scrollY: scrollY, hash: location.hash } satisfies Message);
      window.close();
    } else if (message.kind === "where" && message.to === me) {
      if (message.hash) history.replaceState(history.state, "", message.hash);
      scrollWhenThere(message.scrollY);
    }
  });
  if (taking) channel.postMessage({ kind: "take", from: me } satisfies Message);
}
