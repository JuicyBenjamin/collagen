import { useEffect, useRef, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { isClosed, ticketName, type Ticket } from "@collagen/p2p";
import { Focusable } from "../../../components/Focusable";
import { FollowScroll, type FollowScrollHandle } from "../../../components/FollowScroll";
import { isEnter } from "../../../components/keys";
import { theme } from "../../../app/theme";
import { to, useRouter } from "../../../app/router";
import { clamp } from "../../../lib/math";
import { cells, clip, fitColumns } from "../../../lib/columns";
import { KIND_GLYPH } from "../../../lib/glyphs";
import { age } from "../../../lib/ticketSummary";
import type { HostMerge } from "../../../services/RepoHost";
import { ticketsAtom } from "../overview/components/Tickets/atoms";
import { commentsAtom, identityAtom, membersAtom, reviewsAtom, rosterAtom } from "../atoms";
import { timelineOf, type ProjectMerges } from "../../../services/MergeHistory";
import { openReviewPageAtom } from "../review/atoms";
import { mergesAtom, mergesCursorAtom, moreMergesAtom, openLinkAtom, openMergesPageAtom, refreshMergesAtom } from "./atoms";

/** One line of the list: a project's header (not a stop), a merge, a
 *  ticket it came from, drawn under it, or, past a project's last merge
 *  shown, the more being read (not a stop). */
type Line =
  | { readonly kind: "project"; readonly key: string; readonly text: string; readonly note?: string }
  | { readonly kind: "merge"; readonly key: string; readonly project: string; readonly merge: HostMerge }
  | { readonly kind: "ticket"; readonly key: string; readonly project: string; readonly merge: HostMerge; readonly ticket: Ticket; readonly last: boolean }
  | { readonly kind: "more"; readonly key: string };

/** More merges are read once the cursor is this many rows from a project's last. */
const AHEAD = 10;

/** The merges tab: what was merged into each of your projects' default
 *  branch, the latest first, named by its pull request — and under each, a
 *  line per collagen ticket it came from (lib/mergeTickets), as the
 *  overview draws an epic's tickets; none when it came from none. Read from
 *  the host when the tab opens; `r` refreshes. enter opens a ticket's page,
 *  `o` collagen's own page in the browser (a ticket's review page, else this
 *  history as a web page), `p` the pull request. The cursor holds its row
 *  when a read brings new merges in above it. */
export function MergesPage() {
  const result = useAtomValue(mergesAtom);
  const refresh = useAtomSet(refreshMergesAtom);
  const more = useAtomSet(moreMergesAtom);
  const read = AsyncResult.getOrElse(result, () => null as ReadonlyArray<ProjectMerges> | null);
  const projects = read ?? [];
  const tickets = AsyncResult.getOrElse(useAtomValue(ticketsAtom), () => [] as const);
  const reviews = AsyncResult.getOrElse(useAtomValue(reviewsAtom), () => [] as const);
  const comments = AsyncResult.getOrElse(useAtomValue(commentsAtom), () => [] as const);
  const identity = AsyncResult.getOrElse(useAtomValue(identityAtom), () => null);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const members = AsyncResult.getOrElse(useAtomValue(membersAtom), () => [] as const);
  const openLink = useAtomSet(openLinkAtom);
  const openPage = useAtomSet(openMergesPageAtom);
  const openReviewPage = useAtomSet(openReviewPageAtom);
  const { navigate } = useRouter();
  // the selected row by what it is, not where: a re-read must not move it
  const selKey = useAtomValue(mergesCursorAtom);
  const setSelKey = useAtomSet(mergesCursorAtom);
  const [pane, setPane] = useState<number | undefined>(undefined);
  const list = useRef<FollowScrollHandle>(null);

  const me = identity?.pubkey ?? "";
  const nameFor = (key: string): string =>
    key === me ? "you" : (peers.find((peer) => peer.key === key)?.name ?? members.find((member) => member.key === key)?.name ?? key.slice(0, 8));
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket] as const));
  const now = Date.now();

  const lines: Array<Line> = [];
  for (const timeline of timelineOf(projects, byId, reviews, comments, me)) {
    if (projects.length > 1 || "none" in timeline) lines.push({ kind: "project", key: `p-${timeline.project}`, text: timeline.project, ...("none" in timeline ? { note: timeline.none } : { note: `into ${timeline.base}${timeline.merges.length === 0 ? " · none" : ""}` }) });
    if ("none" in timeline) continue;
    for (const { merge, tickets: shown } of timeline.merges) {
      lines.push({ kind: "merge", key: `m-${timeline.project}-${merge.number}`, project: timeline.project, merge });
      shown.forEach((ticket, index) => lines.push({ kind: "ticket", key: `t-${timeline.project}-${merge.number}-${ticket.id}`, project: timeline.project, merge, ticket, last: index === shown.length - 1 }));
    }
    if (timeline.more) lines.push({ kind: "more", key: `more-${timeline.project}` });
  }
  const stops = lines.filter((stop) => stop.kind === "merge" || stop.kind === "ticket");
  const last = Math.max(0, stops.length - 1);
  const found = selKey === null ? -1 : stops.findIndex((stop) => stop.key === selKey);
  const sel = found < 0 ? 0 : found;
  const current = stops[sel];
  const at = (index: number) => {
    const stop = stops[clamp(index, 0, last)];
    if (stop) setSelKey(stop.key);
    return true;
  };
  const page = () => Math.max(1, list.current?.view().height ?? 10);

  // near a project's last merge shown, its next ones are read: as long as
  // the reader scrolls on, there are more
  const near = current ? projects.find((project) => project.project === current.project) : undefined;
  const nearMore = near && !("none" in near) && near.more ? near : undefined;
  const lastOfNear = nearMore ? stops.findLastIndex((stop) => stop.project === nearMore.project) : -1;
  useEffect(() => {
    if (nearMore && sel >= lastOfNear - AHEAD) more({ project: nearMore.project, count: nearMore.merges.length });
  }, [nearMore, sel, lastOfNear, more]);

  // the title column as wide as the longest title, the info after it; both
  // bounded by the pane (lib/columns)
  const infoOf = (merge: HostMerge): string => `#${merge.number} · ${merge.branch} · ${age(Date.parse(merge.at), now)}`;
  const merges = stops.flatMap((stop) => (stop.kind === "merge" ? [stop.merge] : []));
  const { lead, info } = fitColumns(
    { lead: Math.max(0, ...merges.map((merge) => cells(merge.title || merge.branch))), info: Math.max(0, ...merges.map((merge) => cells(infoOf(merge)))) },
    pane === undefined ? undefined : pane - CURSOR - GAP,
  );
  // a room's merges not in yet, or asked for again (r)
  const reading = read === null;
  const single = projects.length === 1 && !("none" in projects[0]!) ? projects[0] : undefined;

  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
      <Focusable
        id="merges"
        hint={`↑↓ select${current?.kind === "ticket" ? " · enter open" : ""} · o in browser${current ? " · p pull request" : ""} · r refresh`}
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        onKey={(key) => {
          if (key.name === "r") return refresh(), true;
          // o is always one of collagen's own pages: a review's page, else this history at the merge
          if (key.name === "o") return current?.kind === "ticket" && current.ticket.kind === "review" ? openReviewPage({ ticketId: current.ticket.id }) : openPage(current ? { at: { project: current.project, number: current.merge.number } } : {}), true;
          if (stops.length === 0) return false;
          if (key.name === "up" && sel > 0) return at(sel - 1);
          if (key.name === "down" && sel < last) return at(sel + 1);
          if (key.name === "pageup") return at(sel - page());
          if (key.name === "pagedown") return at(sel + page());
          if (key.name === "home") return at(0);
          if (key.name === "end") return at(last);
          if (isEnter(key) && current?.kind === "ticket") return navigate(to.ticket(current.ticket.id, "room/merges")), true;
          if (key.name === "p" && current) return openLink({ url: current.merge.url }), true;
          return false;
        }}
      >
        {(focused) => (
          <>
            <text truncate wrapMode="none" flexShrink={0}>
              <span fg={focused ? theme.accent : theme.fg}>merges</span>
              {single && "base" in single ? <span fg={theme.dim}> into {single.base}</span> : null}
              {reading ? <span fg={theme.dim}> · reading…</span> : null}
            </text>
            {!reading && projects.length === 0 ? (
              <text fg={theme.dim} truncate wrapMode="none">
                {"  "}no projects here
              </text>
            ) : !reading && lines.length === 0 ? (
              <text fg={theme.dim} truncate wrapMode="none">
                {"  "}none
              </text>
            ) : (
              <FollowScroll ref={list} follow={current ? (sel === 0 ? "start" : { id: nearMore && sel === lastOfNear ? `more-${nearMore.project}` : current.key }) : null} onWidth={setPane} flexGrow={1}>
                {lines.map((line) =>
                  line.kind === "project" ? (
                    <text key={line.key} truncate wrapMode="none" flexShrink={0}>
                      <span fg={theme.fg}>{"  "}{line.text}</span>
                      {line.note ? <span fg={theme.dim}> · {line.note}</span> : null}
                    </text>
                  ) : line.kind === "merge" ? (
                    <MergeRow key={line.key} id={line.key} merge={line.merge} info={infoOf(line.merge)} selected={focused && line.key === current?.key} lead={lead} infoWidth={info} />
                  ) : line.kind === "more" ? (
                    <text key={line.key} id={line.key} fg={theme.dim} truncate wrapMode="none" flexShrink={0}>
                      {"    "}loading…
                    </text>
                  ) : (
                    <TicketLine key={line.key} id={line.key} ticket={line.ticket} last={line.last} author={nameFor(line.ticket.createdBy)} mine={line.ticket.createdBy === me} selected={focused && line.key === current?.key} />
                  ),
                )}
              </FollowScroll>
            )}
          </>
        )}
      </Focusable>
    </box>
  );
}

/** The cursor's columns, before every row. */
const CURSOR = 4;
/** Between the title and the info. */
const GAP = 2;
/** The name column under a merge: eight letters and a space. */
const NAME = 9;

/** A merge: its pull request's title (its branch, when it has none), then
 *  its number, branch and how long ago, dim. */
function MergeRow({ id, merge, info, selected, lead, infoWidth }: { id: string; merge: HostMerge; info: string; selected: boolean; lead: number; infoWidth: number }) {
  const color = selected ? theme.accent : theme.fg;
  return (
    <box id={id} flexDirection="row" flexShrink={0}>
      <text fg={color} wrapMode="none" flexShrink={0}>
        {selected ? "  › " : "    "}
      </text>
      <text fg={color} truncate wrapMode="none" flexBasis={lead} flexShrink={1} minWidth={0}>
        {merge.title || merge.branch}
      </text>
      {infoWidth > 0 ? (
        <text fg={theme.dim} wrapMode="none" flexBasis={infoWidth} flexShrink={0} marginLeft={GAP}>
          {clip(info, infoWidth)}
        </text>
      ) : null}
    </box>
  );
}

/** A ticket a merge came from, on the merge's tree: its kind, whose it is,
 *  its title — dim once closed. */
function TicketLine({ id, ticket, last, author, mine, selected }: { id: string; ticket: Ticket; last: boolean; author: string; mine: boolean; selected: boolean }) {
  const color = selected ? theme.accent : isClosed(ticket) ? theme.dim : theme.fg;
  return (
    <box id={id} flexDirection="row" flexShrink={0}>
      <text fg={color} wrapMode="none" flexShrink={0}>
        {selected ? "  › " : "    "}
        <span fg={theme.dim}>{last ? "└ " : "├ "}</span>
        <span fg={theme.dim}>{ticket.kind === "epic" ? "  " : `${KIND_GLYPH[ticket.kind]} `}</span>
        <span fg={mine ? theme.accent : theme.dim}>{author.slice(0, NAME - 1).padEnd(NAME)}</span>
      </text>
      <text fg={color} truncate wrapMode="none" flexShrink={1} minWidth={0}>
        {ticketName(ticket)}
      </text>
    </box>
  );
}
