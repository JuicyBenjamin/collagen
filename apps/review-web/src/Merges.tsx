import {
  createEffect,
  createMemo,
  createSignal,
  Errored,
  For,
  isPending,
  Loading,
  onCleanup,
  Show,
} from "solid-js";
import { ago } from "./ago";
import { enter, leave } from "./fold";
import { mergeHistory } from "./api";
import type { MergeEntry, MergeHistory, MergesShown, MergeTicket, ProjectHistory } from "./data";

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

/** #<project>/<number>: the merge the page opens at, its why open. */
const target: { readonly project: string; readonly number: number } | null = (() => {
  const m = /^#(.+)\/(\d+)$/.exec(location.hash);
  if (!m) return null;
  try {
    return { project: decodeURIComponent(m[1]!), number: Number(m[2]) };
  } catch {
    return null;
  }
})();

const mergeId = (project: string, number: number) =>
  `merge-${encodeURIComponent(project)}-${number}`;

/** More merges each time the reader nears a project's end, as the instance pages them. */
const PAGE = 50;

async function load(roomId: string, shown: MergesShown, fresh: boolean): Promise<MergeHistory> {
  const data = await mergeHistory(roomId, shown, fresh);
  if (!data) throw new Error("This room is not open here.");
  return data;
}

// the clock for "3 h ago", moved twice a minute
const [now, setNow] = createSignal(Date.now());
setInterval(() => setNow(Date.now()), 30_000);

export function MergesApp(props: { roomId: string }) {
  // where it opens is the page's to say (a merge, else the latest), not
  // where it was last scrolled to
  history.scrollRestoration = "manual";
  const [shown, setShown] = createSignal<MergesShown>({});
  const [refreshes, setRefreshes] = createSignal(0);
  const [refreshing, setRefreshing] = createSignal(false);
  let read = 0;
  // what is on screen stays until the new read is in
  const data = createMemo(() => {
    const asked = refreshes();
    const fresh = asked !== read;
    read = asked;
    return load(props.roomId, shown(), fresh);
  });
  const reading = () => {
    try {
      return isPending(() => data());
    } catch {
      return true;
    }
  };
  const more = (project: string, count: number) => {
    setRefreshing(false);
    setShown((s) => ((s[project] ?? 0) >= count + PAGE ? s : { ...s, [project]: count + PAGE }));
  };
  const refresh = () => {
    setRefreshing(true);
    setShown({});
    setRefreshes((n) => n + 1);
  };
  return (
    <Errored
      fallback={(err) => (
        <p class="failed">{err() instanceof Error ? (err() as Error).message : String(err())}</p>
      )}
    >
      <Loading fallback={<p class="loading">Loading the merges…</p>}>
        <Page data={data()} refreshing={refreshing() && reading()} refresh={refresh} more={more} />
      </Loading>
    </Errored>
  );
}

function Page(props: {
  data: MergeHistory;
  refreshing: boolean;
  refresh: () => void;
  more: (project: string, count: number) => void;
}) {
  const single = createMemo(() => {
    const [only, ...rest] = props.data.projects;
    return only && rest.length === 0 && "base" in only ? only : undefined;
  });
  // opened at a merge: more is read until it is in, then it is scrolled to
  let found = target === null;
  createEffect(
    () => props.data,
    (d) => {
      if (found || !target) return;
      const p = d.projects.find((x) => x.project === target.project);
      if (!p || "none" in p) return void (found = true);
      if (p.merges.some((m) => m.number === target.number)) {
        found = true;
        requestAnimationFrame(() =>
          document
            .getElementById(mergeId(target.project, target.number))
            ?.scrollIntoView({ block: "start", behavior: "instant" }),
        );
      } else if (p.more) props.more(p.project, p.merges.length);
      else found = true;
    },
  );
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
          <button
            type="button"
            class="merges-again"
            disabled={props.refreshing}
            onClick={() => props.refresh()}
          >
            {props.refreshing ? "refreshing…" : "refresh"}
          </button>
        </p>
      </header>
      <Show
        when={props.data.projects.length > 0}
        fallback={<p class="merges-none">No projects here</p>}
      >
        <For each={props.data.projects}>
          {(p) => <Project project={p} named={!single()} more={props.more} />}
        </For>
      </Show>
    </main>
  );
}

/** A project's merges — under its name when the room has more than one —
 *  and, while there are more, a line past the last that reads the next ones
 *  as it nears the screen. */
function Project(props: {
  project: ProjectHistory;
  named: boolean;
  more: (project: string, count: number) => void;
}) {
  const p = () => props.project;
  const [near, setNear] = createSignal(false);
  let seen: IntersectionObserver | undefined;
  const watch = (el: HTMLElement) => {
    seen?.disconnect();
    seen = new IntersectionObserver(([e]) => setNear(e!.isIntersecting), {
      rootMargin: "0px 0px 800px 0px",
    });
    seen.observe(el);
  };
  onCleanup(() => seen?.disconnect());
  // near the end, and still near once the new ones are in: more again
  createEffect(
    () => {
      const v = p();
      return near() && "merges" in v && v.more ? v.merges.length : null;
    },
    (count) => {
      if (count !== null) props.more(p().project, count);
    },
  );
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
      <Show
        when={"merges" in p() ? (p() as Extract<ProjectHistory, { merges: unknown }>).merges : null}
      >
        {(merges) => (
          <Show when={merges().length > 0} fallback={<p class="merges-none">None</p>}>
            <ol class="timeline">
              <For each={merges()}>{(m) => <Merge merge={m} project={p().project} />}</For>
            </ol>
            <Show
              when={"more" in p() && (p() as Extract<ProjectHistory, { merges: unknown }>).more}
            >
              <p class="merges-more" ref={watch}>
                Loading…
              </p>
            </Show>
          </Show>
        )}
      </Show>
    </section>
  );
}

/** A merge: its pull request's title (its branch when it has none), its
 *  number, branch and when — then the tickets it came from. */
function Merge(props: { merge: MergeEntry; project: string }) {
  const m = () => props.merge;
  const opened =
    target !== null && target.project === props.project && target.number === props.merge.number;
  return (
    <li class={{ merge: true, target: opened }} id={mergeId(props.project, props.merge.number)}>
      <p class="merge-title">
        <a href={m().url} target="_blank" rel="noreferrer">
          {m().title || m().branch}
        </a>
      </p>
      <p class="merge-info">
        #{m().number} · <code>{m().branch}</code> ·{" "}
        <time datetime={m().at}>{ago(Date.parse(m().at), now())}</time>
      </p>
      <Show when={m().epics.length > 0}>
        <p class="merge-epics">
          <KindIcon kind="epic" />
          {m()
            .epics.map((e) => e.name)
            .join(" · ")}
        </p>
      </Show>
      <Show when={m().tickets.length > 0}>
        <ul class="lineage">
          <For each={m().tickets}>
            {(t) => <Lineage ticket={t} open={opened && t.kind === "review"} />}
          </For>
        </ul>
      </Show>
    </li>
  );
}

/** One ticket of what a merge grew from: its kind's mark, its name (a
 *  review links to its page), whose it is when not the reader's, and its
 *  why, folded under it. */
function Lineage(props: { ticket: MergeTicket; open: boolean }) {
  const t = () => props.ticket;
  // open is what the reader asked; shown keeps the why placed while it closes
  const [open, setOpen] = createSignal(props.open);
  const [shown, setShown] = createSignal(props.open);
  let box: HTMLDivElement | undefined;
  let toggled = false;
  const toggle = async () => {
    toggled = true;
    if (!open()) return void (setOpen(true), setShown(true));
    setOpen(false);
    await leave(box);
    if (!open()) setShown(false);
  };
  const count = () => t().decisions.length;
  return (
    <li class={["lineage-item", t().kind, { closed: t().closed, open: open() }]}>
      <div class="lineage-row">
        <KindIcon kind={t().kind} />
        <Show when={t().kind === "review"} fallback={<span class="lineage-name">{t().name}</span>}>
          <a class="lineage-name" href={`/review/${encodeURIComponent(t().id)}`}>
            {t().name}
          </a>
        </Show>
        <Show when={!t().mine}>
          <span class="lineage-by">{t().author}</span>
        </Show>
        <Show when={count() > 0}>
          <button
            type="button"
            class="lineage-why"
            aria-expanded={open() ? "true" : "false"}
            onClick={() => void toggle()}
          >
            {count() === 1 ? "why" : `${count()} decisions`}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </Show>
      </div>
      <Show when={shown() && count() > 0}>
        <div
          class="lineage-open"
          ref={(el) => {
            box = el;
            if (toggled) enter(el);
          }}
        >
          <div class="lineage-decisions">
            <For each={t().decisions}>
              {(d) => (
                <div class="lineage-decision">
                  <p class="lineage-decision-title">{d.title}</p>
                  <Show when={d.title !== d.what}>
                    <p>{d.what}</p>
                  </Show>
                  <Show when={d.userWhy}>{(w) => <blockquote>{w()}</blockquote>}</Show>
                  <Show when={d.agentWhy}>
                    {(w) => <p class="lineage-decision-agent">{w()}</p>}
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </li>
  );
}

/** A ticket's kind as a mark, coloured by kind. */
function KindIcon(props: { kind: MergeTicket["kind"] }) {
  return (
    <svg
      class="kind-icon"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      role="img"
      aria-label={props.kind}
    >
      {(() => {
        switch (props.kind) {
          case "proposal":
            return (
              <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" />
            );
          case "plan":
            return <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15" />;
          case "task":
            return <path d="M4 4h16v16H4zM8 12l3 3 5-6" />;
          case "bug":
            return <path d="M4 21V4h12l-2 4 2 4H4" />;
          case "review":
            return (
              <>
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
              </>
            );
          case "epic":
            return <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />;
        }
      })()}
    </svg>
  );
}
