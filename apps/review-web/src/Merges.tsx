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
import { ago } from "./when";
import { Corner } from "./components/Corner";
import { KindIcon } from "./components/KindIcon";
import { enter, leave } from "./fold";
import { mergeHistory, mergeProjects } from "./api";
import type { MergeEntry, MergeHistory, MergeProjects, MergeTicket, ProjectHistory } from "./data";

// A project's merges page: what was merged into one of a room's projects,
// the latest first, as the TUI's merges tab has it — each merge linked to
// its pull request, and under it the tickets it came from, each linked to
// its review page; above, a tab for each of the room's projects, in the
// reader's order. One read, from one moment (the host's merges and the
// room's tickets together); read again when the reader asks. Merges are not
// pushed to the instance, so nothing here moves on its own. A room's
// address, /merges/<roomId>, goes on to its first project's.

/** /merges/<roomId>/<project>, or a room's /merges/<roomId> — the page's
 *  arguments; null on any other page. */
export const mergesPlace: { readonly room: string; readonly project: string | null } | null = (() => {
  const [first, room, project] = location.pathname.split("/").filter(Boolean);
  if (first !== "merges") return null;
  try {
    return { room: decodeURIComponent(room ?? ""), project: project === undefined ? null : decodeURIComponent(project) };
  } catch {
    return { room: "", project: null };
  }
})();

/** A project's merges page, at one of its merges when `number` names it. */
const projectUrl = (roomId: string, project: string, number?: number) =>
  `/merges/${encodeURIComponent(roomId)}/${encodeURIComponent(project)}${number === undefined ? "" : `#${number}`}`;

/** #<number>: the merge the page opens at, its why open. */
const target: number | null = (() => {
  const match = /^#(\d+)$/.exec(location.hash);
  return match ? Number(match[1]) : null;
})();

const mergeId = (number: number) => `merge-${number}`;

/** More merges each time the reader nears the end, as the instance pages them. */
const PAGE = 50;

async function load(roomId: string, project: string, shown: number, fresh: boolean): Promise<MergeHistory> {
  const data = await mergeHistory(roomId, project, shown, fresh);
  if (!data) throw new Error("This room is not open here.");
  return data;
}

async function loadProjects(roomId: string): Promise<MergeProjects> {
  const data = await mergeProjects(roomId);
  if (!data) throw new Error("This room is not open here.");
  return data;
}

// the clock for "3 h ago", moved twice a minute
const [now, setNow] = createSignal(Date.now());
setInterval(() => setNow(Date.now()), 30_000);

/** A room's merges address: on to the project a link names
 *  (#<project>/<number>, as these links once were), else the reader's first. */
export function MergesRoom(props: { roomId: string }) {
  const data = createMemo(() => loadProjects(props.roomId));
  createEffect(
    () => data(),
    (read) => {
      const named = /^#(.+)\/(\d+)$/.exec(location.hash);
      let project: string | undefined;
      try {
        project = named ? decodeURIComponent(named[1]!) : undefined;
      } catch {
        project = undefined;
      }
      const to = project ?? read.projects[0];
      if (to !== undefined) location.replace(projectUrl(props.roomId, to, named && project ? Number(named[2]) : undefined));
    },
  );
  return (
    <Errored
      fallback={(error) => (
        <p class="failed">{error() instanceof Error ? (error() as Error).message : String(error())}</p>
      )}
    >
      <Loading fallback={<p class="loading">Loading the merges…</p>}>
        <Show when={data().projects.length === 0}>
          <main class="merges-page">
            <header>
              <h1>Merges</h1>
              <p class="meta">{data().room}</p>
            </header>
            <p class="merges-none">No projects here</p>
          </main>
        </Show>
      </Loading>
    </Errored>
  );
}

export function MergesApp(props: { roomId: string; project: string }) {
  // where it opens is the page's to say (a merge, else the latest), not
  // where it was last scrolled to
  history.scrollRestoration = "manual";
  const [shown, setShown] = createSignal(PAGE);
  const [refreshes, setRefreshes] = createSignal(0);
  const [refreshing, setRefreshing] = createSignal(false);
  let read = 0;
  // what is on screen stays until the new read is in
  const data = createMemo(() => {
    const asked = refreshes();
    const fresh = asked !== read;
    read = asked;
    return load(props.roomId, props.project, shown(), fresh);
  });
  const reading = () => {
    try {
      return isPending(() => data());
    } catch {
      return true;
    }
  };
  const more = (count: number) => {
    setRefreshing(false);
    setShown((previous) => (previous >= count + PAGE ? previous : count + PAGE));
  };
  const refresh = () => {
    setRefreshing(true);
    setShown(PAGE);
    setRefreshes((previous) => previous + 1);
  };
  return (
    <Errored
      fallback={(error) => (
        <p class="failed">{error() instanceof Error ? (error() as Error).message : String(error())}</p>
      )}
    >
      <Loading fallback={<p class="loading">Loading the merges…</p>}>
        <Page roomId={props.roomId} data={data()} refreshing={refreshing() && reading()} refresh={refresh} more={more} />
      </Loading>
    </Errored>
  );
}

function Page(props: {
  roomId: string;
  data: MergeHistory;
  refreshing: boolean;
  refresh: () => void;
  more: (count: number) => void;
}) {
  // opened at a merge: more is read until it is in, then it is scrolled to
  let found = target === null;
  createEffect(
    () => props.data,
    (data) => {
      if (found || target === null) return;
      const history = data.history;
      if ("none" in history) return void (found = true);
      if (history.merges.some((merge) => merge.number === target)) {
        found = true;
        requestAnimationFrame(() =>
          document.getElementById(mergeId(target))?.scrollIntoView({ block: "start", behavior: "instant" }),
        );
      } else if (history.more) props.more(history.merges.length);
      else found = true;
    },
  );
  createEffect(
    () => [props.data.history.project, props.data.room] as const,
    ([project, room]) => {
      document.title = `Merges — ${project} · ${room}`;
    },
  );
  return (
    <main class="merges-page">
      <header>
        <h1>Merges</h1>
        <Corner />
        <p class="meta">
          {props.data.room}
          {(() => {
            const history = props.data.history;
            return "none" in history ? (
              ` · ${history.none}`
            ) : (
              <>
                {" · into "}
                <code>{history.base}</code>
              </>
            );
          })()}
          {" · "}
          <button
            type="button"
            class="btn btn-xs"
            disabled={props.refreshing}
            onClick={() => props.refresh()}
          >
            {props.refreshing ? "refreshing…" : "refresh"}
          </button>
        </p>
      </header>
      <nav class="merges-projects" aria-label="Projects">
        <For each={props.data.projects}>
          {(project) => (
            <a
              href={projectUrl(props.roomId, project)}
              class={{ on: project === props.data.history.project }}
              aria-current={project === props.data.history.project ? "page" : undefined}
            >
              {project}
            </a>
          )}
        </For>
      </nav>
      <Project project={props.data.history} more={props.more} />
    </main>
  );
}

/** A project's merges and, while there are more, a line past the last
 *  that reads the next ones as it nears the screen. */
function Project(props: {
  project: ProjectHistory;
  more: (count: number) => void;
}) {
  const projectHistory = () => props.project;
  const [near, setNear] = createSignal(false);
  let seen: IntersectionObserver | undefined;
  const watch = (element: HTMLElement) => {
    seen?.disconnect();
    seen = new IntersectionObserver(([entry]) => setNear(entry!.isIntersecting), {
      rootMargin: "0px 0px 800px 0px",
    });
    seen.observe(element);
  };
  onCleanup(() => seen?.disconnect());
  // near the end, and still near once the new ones are in: more again
  createEffect(
    () => {
      const current = projectHistory();
      return near() && "merges" in current && current.more ? current.merges.length : null;
    },
    (count) => {
      if (count !== null) props.more(count);
    },
  );
  return (
    <section class="merges-project">
      <Show
        when={"merges" in projectHistory() ? (projectHistory() as Extract<ProjectHistory, { merges: unknown }>).merges : null}
      >
        {(merges) => (
          <Show when={merges().length > 0} fallback={<p class="merges-none">None</p>}>
            <ol class="timeline">
              <For each={merges()}>{(merge) => <Merge merge={merge} />}</For>
            </ol>
            <Show
              when={"more" in projectHistory() && (projectHistory() as Extract<ProjectHistory, { merges: unknown }>).more}
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
function Merge(props: { merge: MergeEntry }) {
  const merge = () => props.merge;
  const opened = target !== null && target === props.merge.number;
  return (
    <li class={{ merge: true, target: opened }} id={mergeId(props.merge.number)}>
      <p class="merge-title">
        <a href={merge().url} target="_blank" rel="noreferrer">
          {merge().title || merge().branch}
        </a>
      </p>
      <p class="merge-info">
        #{merge().number} · <code>{merge().branch}</code> ·{" "}
        <time datetime={merge().at}>{ago(Date.parse(merge().at), now())}</time>
      </p>
      <Show when={merge().epics.length > 0}>
        <p class="merge-epics">
          <KindIcon kind="epic" />
          {merge()
            .epics.map((epic) => epic.name)
            .join(" · ")}
        </p>
      </Show>
      <Show when={merge().tickets.length > 0}>
        <ul class="lineage">
          <For each={merge().tickets}>
            {(ticket) => <Lineage ticket={ticket} open={opened && ticket.kind === "review"} />}
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
  const ticket = () => props.ticket;
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
  const count = () => ticket().decisions.length;
  return (
    <li class={["lineage-item", ticket().kind, { closed: ticket().closed, open: open() }]}>
      <div class="lineage-row">
        <KindIcon kind={ticket().kind} />
        <Show when={ticket().kind === "review"} fallback={<span class="lineage-name">{ticket().name}</span>}>
          <a class="lineage-name" href={`/review/${encodeURIComponent(ticket().id)}`}>
            {ticket().name}
          </a>
        </Show>
        <Show when={!ticket().mine}>
          <span class="lineage-by">{ticket().author}</span>
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
          ref={(element) => {
            box = element;
            if (toggled) enter(element);
          }}
        >
          <div class="lineage-decisions">
            <For each={ticket().decisions}>
              {(decision) => (
                <div class="lineage-decision">
                  <p class="lineage-decision-title">{decision.title}</p>
                  <Show when={decision.title !== decision.what}>
                    <p>{decision.what}</p>
                  </Show>
                  <Show when={decision.userWhy}>{(why) => <blockquote>{why()}</blockquote>}</Show>
                  <Show when={decision.agentWhy}>
                    {(why) => <p class="lineage-decision-agent">{why()}</p>}
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
