import { createSignal, For, Show } from "solid-js";
import type { HostNote, HostReview } from "../data";
import { hostNow } from "../hostNow";
import { bodyParts } from "../suggest";

/** "just now", "4 min ago", "3 h ago", a date — from `now`. */
const ago = (t: number, now: number): string => {
  const mins = Math.round((now - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(t).toLocaleDateString();
};

type Item = ({ readonly kind: "review" } & HostReview) | ({ readonly kind: "note" } & HostNote);

/** Words as written, never as HTML; a suggested change in them as code. */
function Words(props: { body: string }) {
  return (
    <For each={bodyParts(props.body)}>
      {(part) => (part.kind === "text" ? <p class="host-body">{part.text}</p> : <pre class="host-suggestion">{part.code}</pre>)}
    </For>
  );
}

/** What has been said on the pull request apart from its lines: each review
 *  with its verdict and words on the whole, the conversation, and line
 *  comments on code that has changed since — oldest first, so a review of
 *  the review reads in order. The line comments themselves sit under their
 *  lines. The host is asked when the page opens and on the reader's word, not
 *  on a timer: when it was last asked is said here, with Refresh beside it. */
/** How many of the latest show before the rest are asked for — a busy pull
 *  request's conversation should not push the code far down the page. */
const LATEST = 3;

export function HostActivity() {
  const h = hostNow.host;
  const [all, setAll] = createSignal(false);
  const items = (): ReadonlyArray<Item> => {
    const v = h();
    if (!v) return [];
    return [...v.reviews.map((r): Item => ({ kind: "review", ...r })), ...v.conversation.map((n): Item => ({ kind: "note", ...n }))].sort((a, b) => a.at.localeCompare(b.at));
  };
  const counts = () => {
    const v = h();
    if (!v) return "";
    const r = v.reviews.length;
    const c = v.conversation.length;
    return [r > 0 ? `${r} ${r === 1 ? "review" : "reviews"}` : "", c > 0 ? `${c} ${c === 1 ? "comment" : "comments"}` : ""].filter(Boolean).join(" · ");
  };
  return (
    <Show when={h()?.pull}>
      {(pull) => (
        <section class="host-activity" aria-label={`On ${hostNow.hostName()}`}>
          <div class="host-head">
            <h2>On {hostNow.hostName()}</h2>
            <span class="host-counts">{counts() || `nothing said on #${pull().number} yet`}</span>
            <span class="host-checked">
              {hostNow.checking() ? "checking…" : `checked ${ago(hostNow.checkedAt() ?? hostNow.now(), hostNow.now())}`}
            </span>
            <button type="button" class="quiet small" onClick={() => hostNow.refresh()} disabled={hostNow.checking()} title={`Ask ${hostNow.hostName()} again for its reviews and comments`}>
              ↻ Refresh
            </button>
          </div>
          <Show when={items().length > LATEST}>
            <button type="button" class="quiet small host-earlier" onClick={() => setAll(!all())}>
              {all() ? "Show only the latest" : `Show ${items().length - LATEST} earlier`}
            </button>
          </Show>
          <Show when={items().length > 0}>
            <ol class="host-items">
              <For each={all() ? items() : items().slice(-LATEST)}>
                {(it) => (
                  <li class="host-item">
                    <div class="line-comment-head">
                      <Show when={it.author.avatarUrl}>{(src) => <img class="avatar" src={src()} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} width={18} height={18} />}</Show>
                      <strong>{it.author.login}</strong>
                      <Show when={it.kind === "review"}>
                        <span class={["verdict", (it as HostReview).verdict.replace(" ", "-")]}>{(it as HostReview).verdict}</span>
                      </Show>
                      <Show when={it.kind === "note" && (it as HostNote).outdated}>
                        {(where) => <span class="line-comment-when">on {where()} · since changed</span>}
                      </Show>
                      <span class="line-comment-when">{it.at ? ago(Date.parse(it.at), hostNow.now()) : ""}</span>
                      <Show when={it.url}>
                        {(url) => (
                          <a class="line-comment-link" href={url()} target="_blank" rel="noreferrer">
                            on {hostNow.hostName()}
                          </a>
                        )}
                      </Show>
                    </div>
                    <Show when={it.body.trim().length > 0}>
                      <Words body={it.body} />
                    </Show>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </section>
      )}
    </Show>
  );
}
