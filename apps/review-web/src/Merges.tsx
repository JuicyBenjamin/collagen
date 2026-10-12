import { createEffect, createMemo, createSignal, Errored, For, isPending, Loading, Show } from "solid-js";
import { ago } from "./ago";
import { mergeHistory } from "./api";
import type { MergeEntry, MergeHistory, ProjectHistory } from "./data";

// The merge history page: what was merged into each of a room's projects,
// the latest first, as the TUI's merges tab has it — each merge linked to
// its pull request, and under it the tickets it came from, each linked to
// its review page. One read, from one moment (the host's merges and the
// room's tickets together); read again when the reader asks. Merges are not
// pushed to the instance, so nothing here moves on its own.

/** /merges/<roomId> — the page's one argument; null on any other page. */
export const mergesRoom: string | null = (() => {
  const [first, id] = location.pathname.split("/").filter(Boolean);
  if (first !== "merges") return null;
  try {
    return decodeURIComponent(id ?? "");
  } catch {
    return "";
  }
})();

async function load(roomId: string): Promise<MergeHistory> {
  const data = await mergeHistory(roomId);
  if (!data) throw new Error("This room is not open here.");
  return data;
}

// the clock for "3 h ago", moved twice a minute
const [now, setNow] = createSignal(Date.now());
setInterval(() => setNow(Date.now()), 30_000);

export function MergesApp(props: { roomId: string }) {
  const [asked, setAsked] = createSignal(0);
  // what is on screen stays until the new read is in
  const data = createMemo(() => {
    asked();
    return load(props.roomId);
  });
  const reading = () => {
    try {
      return isPending(() => data());
    } catch {
      return true;
    }
  };
  return (
    <Errored fallback={(err) => <p class="failed">{err() instanceof Error ? (err() as Error).message : String(err())}</p>}>
      <Loading fallback={<p class="loading">Reading the merges…</p>}>
        <Page data={data()} reading={reading()} again={() => setAsked((n) => n + 1)} />
      </Loading>
    </Errored>
  );
}

function Page(props: { data: MergeHistory; reading: boolean; again: () => void }) {
  const single = createMemo(() => {
    const [only, ...rest] = props.data.projects;
    return only && rest.length === 0 && "base" in only ? only : undefined;
  });
  createEffect(
    () => props.data.room,
    (room) => {
      document.title = `Merges — ${room}`;
    },
  );
  return (
    <main class="merges-page">
      <header>
        <h1>Merges</h1>
        <p class="meta">
          {props.data.room}
          <Show when={single()}>
            {(p) => (
              <>
                {" · into "}
                <code>{p().base}</code>
              </>
            )}
          </Show>
          {" · "}
          <button type="button" class="merges-again" disabled={props.reading} onClick={() => props.again()}>
            {props.reading ? "reading…" : `read ${ago(Date.parse(props.data.readAt), now())}`}
          </button>
        </p>
      </header>
      <Show when={props.data.projects.length > 0} fallback={<p class="merges-none">No projects here</p>}>
        <For each={props.data.projects}>{(p) => <Project project={p} named={!single()} />}</For>
      </Show>
    </main>
  );
}

/** A project's merges — under its name when the room has more than one. */
function Project(props: { project: ProjectHistory; named: boolean }) {
  const p = () => props.project;
  return (
    <section class="merges-project">
      <Show when={props.named}>
        <h2>
          {p().project}
          <span class="merges-project-note">
            {(() => {
              const v = p();
              return "none" in v ? ` · ${v.none}` : ` · into ${v.base}`;
            })()}
          </span>
        </h2>
      </Show>
      <Show when={"merges" in p() ? (p() as Extract<ProjectHistory, { merges: unknown }>).merges : null}>
        {(merges) => (
          <Show when={merges().length > 0} fallback={<p class="merges-none">None</p>}>
            <ol class="timeline">
              <For each={merges()}>{(m) => <Merge merge={m} />}</For>
            </ol>
          </Show>
        )}
      </Show>
    </section>
  );
}

/** A merge: its pull request's title (its branch when it has none), its
 *  number, branch and when — then the tickets it came from. */
function Merge(props: { merge: MergeEntry }) {
  const m = () => props.merge;
  return (
    <li class="merge">
      <p class="merge-title">
        <a href={m().url} target="_blank" rel="noreferrer">
          {m().title || m().branch}
        </a>
      </p>
      <p class="merge-info">
        #{m().number} · <code>{m().branch}</code> · <time datetime={m().at}>{ago(Date.parse(m().at), now())}</time>
      </p>
      <Show when={m().tickets.length > 0}>
        <ul class="merge-tickets">
          <For each={m().tickets}>
            {(t) => (
              <li class={{ closed: t.closed }}>
                <a href={`/review/${encodeURIComponent(t.id)}`}>{t.name}</a>
                <span class={["merge-ticket-by", { mine: t.mine }]}>{t.author}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
}
