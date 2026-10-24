import { createEffect, createSignal, For, Show } from "solid-js";
import { ago } from "~/ago";
import type { HostNote, HostReview, HostUser } from "~/data";
import { enter, leave } from "~/fold";
import { hostNow } from "~/hostNow";
import { lastActivity } from "../lastActivity";
import { Appear } from "~/components/Appear";
import { bodyParts } from "~/suggest";
import { Markdown } from "~/components/Markdown";
import { StrengthMark } from "~/components/Strength";
import { Detail } from "~/components/Detail";
import { wordsOf } from "~/forPeople";
import { readStrength, type Strength } from "~/strength";

type Item = ({ readonly kind: "review" } & HostReview) | ({ readonly kind: "note" } & HostNote);
/** A comment's strength apart from its words, written for people first (an
 *  AI's in full one step away); a review's words on the whole carry none. */
const words = (item: Item): { readonly strength: Strength | null; readonly text: string; readonly detail?: string } => {
  if (item.kind !== "note") return { strength: null, text: item.body };
  const shown = wordsOf(item);
  return { ...readStrength(shown.body), ...(shown.detail !== undefined ? { detail: shown.detail } : {}) };
};

/** Words as markdown, never as HTML; a suggested change in them as code. */
function Words(props: { body: string }) {
  return (
    <For each={bodyParts(props.body)}>
      {(part) => (part.kind === "text" ? <Markdown text={part.text} /> : <pre class="host-suggestion">{part.code}</pre>)}
    </For>
  );
}

/** What has been said on the pull request apart from its lines: each review
 *  with its verdict and words on the whole, the conversation, and line
 *  comments on code that has changed since — oldest first, so a review of
 *  the review reads in order. The line comments themselves sit under their
 *  lines. Folded until opened to how much was said and who said it — much of
 *  it is bots. The host is asked when the page opens and on the reader's word,
 *  not on a timer: when it was last asked is said here, with Refresh beside it. */
/** How many of the latest show before the rest are asked for — a busy pull
 *  request's conversation should not push the code far down the page. */
const LATEST = 3;
/** How many commenters' avatars the folded comments show before "+n". */
const AVATARS = 5;

export function Said() {
  const host = hostNow.host;
  const [all, setAll] = createSignal(false);
  // open is what the reader asked; shown keeps the conversation placed while it closes
  const [open, setOpen] = createSignal(false);
  const [shown, setShown] = createSignal(false);
  let body: HTMLDivElement | undefined;
  let toggled = false;
  const toggle = async () => {
    toggled = true;
    if (!open()) return void (setOpen(true), setShown(true));
    setOpen(false);
    await leave(body);
    if (!open()) setShown(false);
  };
  const items = (): ReadonlyArray<Item> => {
    const activity = host();
    if (!activity) return [];
    return [...activity.reviews.map((review): Item => ({ kind: "review", ...review })), ...activity.conversation.map((note): Item => ({ kind: "note", ...note }))].sort((a, b) => a.at.localeCompare(b.at));
  };
  /** the reader, as the host knows them: whose avatar and reviews are marked theirs */
  const isMe = (user: HostUser) => host()?.viewer?.login === user.login;
  /** who said something, each once, in the order they first did — the reader first */
  const speakers = (): ReadonlyArray<HostUser> => {
    const seen = new Map<string, HostUser>();
    for (const item of items()) if (!seen.has(item.author.login)) seen.set(item.author.login, item.author);
    return [...seen.values()].sort((a, b) => Number(isMe(b)) - Number(isMe(a)));
  };
  const counts = () => {
    const activity = host();
    if (!activity) return "";
    const reviewCount = activity.reviews.length;
    const commentCount = activity.conversation.length;
    return [reviewCount > 0 ? `${reviewCount} ${reviewCount === 1 ? "review" : "reviews"}` : "", commentCount > 0 ? `${commentCount} ${commentCount === 1 ? "comment" : "comments"}` : ""].filter(Boolean).join(" · ");
  };
  // whether it stood here, and with comments, kept for the next open's placeholder
  createEffect(
    () => (hostNow.view() === null ? null : { shown: Boolean(host()?.pull), talked: items().length > 0 }),
    (said) => {
      if (said) lastActivity.keep(said);
    },
  );
  // a pull request that comes, or goes, after the page: it opens into place, and closes
  return (
    <Appear when={host()?.pull}>
      {(pull) => (
        <section class="host-activity" aria-label={`On ${hostNow.hostName()}`}>
          <div class="host-head">
            <h2>On {hostNow.hostName()}</h2>
            <Show when={items().length === 0}>
              <span class="host-counts">nothing said on #{pull().number} yet</span>
            </Show>
            <span class="host-checked">
              {hostNow.checking() ? "checking…" : `checked ${ago(hostNow.checkedAt() ?? hostNow.now(), hostNow.now())}`}
            </span>
            <button type="button" class="btn btn-xs" onClick={() => hostNow.refresh()} disabled={hostNow.checking()} title={`Ask ${hostNow.hostName()} again for its reviews and comments`}>
              ↻ Refresh
            </button>
          </div>
          <Show when={items().length > 0}>
            <button type="button" class="host-fold" aria-expanded={open() ? "true" : "false"} onClick={() => void toggle()}>
              <span class="host-fold-mark">{open() ? "▾" : "▸"}</span>
              <span class="host-avatars">
                <For each={speakers().slice(0, AVATARS)}>
                  {(speaker) =>
                    speaker.avatarUrl ? (
                      <img class={["avatar", { mine: isMe(speaker) }]} src={speaker.avatarUrl} alt="" title={isMe(speaker) ? `${speaker.login} (you)` : speaker.login} onError={(event) => (event.currentTarget.style.visibility = "hidden")} width={18} height={18} />
                    ) : (
                      <span class={["avatar host-initial", { mine: isMe(speaker) }]} title={isMe(speaker) ? `${speaker.login} (you)` : speaker.login}>
                        {speaker.login.slice(0, 1).toUpperCase()}
                      </span>
                    )
                  }
                </For>
                <Show when={speakers().length > AVATARS}>
                  <span class="host-more">+{speakers().length - AVATARS}</span>
                </Show>
              </span>
              <span>{counts()}</span>
            </button>
          </Show>
          <Show when={shown()}>
            <div
              ref={(element) => {
                body = element;
                if (toggled) enter(element);
              }}
            >
          <Show when={items().length > LATEST}>
            <button type="button" class="btn btn-xs host-earlier" onClick={() => setAll(!all())}>
              {all() ? "Show only the latest" : `Show ${items().length - LATEST} earlier`}
            </button>
          </Show>
            <ol class="host-items">
              <For each={all() ? items() : items().slice(-LATEST)}>
                {(item) => (
                  <li class={["host-item", { mine: isMe(item.author) }]}>
                    <div class="line-comment-head">
                      <Show when={item.author.avatarUrl}>{(src) => <img class="avatar" src={src()} alt="" onError={(event) => (event.currentTarget.style.visibility = "hidden")} width={18} height={18} />}</Show>
                      <strong>{item.author.login}</strong>
                      <Show when={isMe(item.author)}>
                        <span class="you-mark">you</span>
                      </Show>
                      <Show when={item.kind === "review"}>
                        <span class={["verdict", (item as HostReview).verdict.replace(" ", "-")]}>{(item as HostReview).verdict}</span>
                      </Show>
                      <StrengthMark strength={words(item).strength} />
                      <Show when={item.kind === "note" && (item as HostNote).outdated}>
                        {(where) => <span class="line-comment-when">on {where()} · since changed</span>}
                      </Show>
                      <span class="line-comment-when">{item.at ? ago(Date.parse(item.at), hostNow.now()) : ""}</span>
                      <Show when={item.url}>
                        {(url) => (
                          <a class="line-comment-link" href={url()} target="_blank" rel="noreferrer">
                            on {hostNow.hostName()}
                          </a>
                        )}
                      </Show>
                    </div>
                    <Show when={item.body.trim().length > 0}>
                      <Words body={words(item).text} />
                      <Detail text={words(item).detail} />
                    </Show>
                  </li>
                )}
              </For>
            </ol>
            </div>
          </Show>
        </section>
      )}
    </Appear>
  );
}
