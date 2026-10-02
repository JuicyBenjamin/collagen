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

/** Scroll to `y` once the page is tall enough to have it — the data comes
 *  in after the handover, so wait for it, but not for ever. */
function scrollWhenThere(y: number) {
  const until = Date.now() + 3_000;
  const step = () => {
    if (document.documentElement.scrollHeight >= y + innerHeight || Date.now() > until) scrollTo(0, y);
    else requestAnimationFrame(step);
  };
  step();
}

/** In-page links jump without a history entry, so the page stays closable
 *  (and back leaves the review rather than walking its anchors). */
function linksInPlace() {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.("a[href^='#']");
    const id = a?.getAttribute("href")?.slice(1);
    if (!id) return;
    e.preventDefault();
    history.replaceState(history.state, "", `#${id}`);
    document.getElementById(decodeURIComponent(id))?.scrollIntoView();
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
  channel.addEventListener("message", (e: MessageEvent<Message>) => {
    const m = e.data;
    if (m.kind === "take" && m.from !== me) {
      channel.postMessage({ kind: "where", to: m.from, scrollY: scrollY, hash: location.hash } satisfies Message);
      window.close();
    } else if (m.kind === "where" && m.to === me) {
      if (m.hash) history.replaceState(history.state, "", m.hash);
      scrollWhenThere(m.scrollY);
    }
  });
  if (taking) channel.postMessage({ kind: "take", from: me } satisfies Message);
}
