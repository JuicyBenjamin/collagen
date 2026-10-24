import { useEffect, useRef, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { Ticket as TicketRecord } from "@collagen/p2p";
import { Focusable } from "../../../../../components/Focusable";
import { FollowScroll, type FollowScrollHandle } from "../../../../../components/FollowScroll";
import { isEnter } from "../../../../../components/keys";
import { theme } from "../../../../../app/theme";
import { to, useRouter } from "../../../../../app/router";
import { clamp } from "../../../../../lib/math";
import { cells, fitColumns } from "../../../../../lib/columns";
import { age } from "../../../../../lib/ticketSummary";
import type { HostMerge } from "../../../../../services/RepoHost";
import { timelineOf, type ProjectMerges } from "../../../../../services/MergeHistory";
import { ticketsAtom } from "../../../overview/components/Tickets/atoms";
import { commentsAtom, identityAtom, membersAtom, reviewsAtom, rosterAtom } from "../../../atoms";
import { openReviewPageAtom } from "../../../review/atoms";
import { mergesAtom, mergesCursorAtom, moreMergesAtom, openLinkAtom, openMergesPageAtom, refreshMergesAtom } from "../../atoms";
import { CURSOR, GAP, Merge } from "./components/Merge";
import { Ticket } from "./components/Ticket";

/** One line of the list: a merge, a ticket it came from, drawn under it,
 *  or, past the last merge shown, the more being read (not a stop). */
type Line =
  | { readonly kind: "merge"; readonly key: string; readonly merge: HostMerge }
  | { readonly kind: "ticket"; readonly key: string; readonly merge: HostMerge; readonly ticket: TicketRecord; readonly last: boolean }
  | { readonly kind: "more"; readonly key: string };

/** More merges are read once the cursor is this many rows from the last. */
const AHEAD = 10;

/** One project's merges: what was merged into its default branch, the
 *  latest first, named by its pull request — and under each, a line per
 *  collagen ticket it came from (lib/mergeTickets), as the overview draws
 *  an epic's tickets; none when it came from none. Read from the host when
 *  its tab opens; `r` refreshes. enter opens a ticket's page, `o`
 *  collagen's own page in the browser (a ticket's review page, else this
 *  history as a web page), `p` the pull request. The cursor holds its row
 *  when a read brings new merges in above it. */
export function List({ project }: { project: string }) {
  const result = useAtomValue(mergesAtom(project));
  const refresh = useAtomSet(refreshMergesAtom);
  const more = useAtomSet(moreMergesAtom);
  const read = AsyncResult.getOrElse(result, () => null as ProjectMerges | null);
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

  const [timeline] = read ? timelineOf([read], byId, reviews, comments, me) : [];
  const lines: Array<Line> = [];
  if (timeline && !("none" in timeline)) {
    for (const { merge, tickets: shown } of timeline.merges) {
      lines.push({ kind: "merge", key: `m-${project}-${merge.number}`, merge });
      shown.forEach((ticket, index) => lines.push({ kind: "ticket", key: `t-${project}-${merge.number}-${ticket.id}`, merge, ticket, last: index === shown.length - 1 }));
    }
    if (timeline.more) lines.push({ kind: "more", key: `more-${project}` });
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

  // near the last merge shown, the next ones are read: as long as the
  // reader scrolls on, there are more
  const count = read && !("none" in read) && read.more ? read.merges.length : null;
  useEffect(() => {
    if (count !== null && sel >= last - AHEAD) more({ project, count });
  }, [count, sel, last, project, more]);

  // the title column as wide as the longest title, the info after it; both
  // bounded by the pane (lib/columns)
  const infoOf = (merge: HostMerge): string => `#${merge.number} · ${merge.branch} · ${age(Date.parse(merge.at), now)}`;
  const merges = stops.flatMap((stop) => (stop.kind === "merge" ? [stop.merge] : []));
  const { lead, info } = fitColumns(
    { lead: Math.max(0, ...merges.map((merge) => cells(merge.title || merge.branch))), info: Math.max(0, ...merges.map((merge) => cells(infoOf(merge)))) },
    pane === undefined ? undefined : pane - CURSOR - GAP,
  );
  // the project's merges not in yet, or asked for again (r)
  const reading = read === null;

  return (
    <Focusable
      id="merges"
      hint={`↑↓ select${current?.kind === "ticket" ? " · enter open" : ""} · o in browser${current ? " · p pull request" : ""} · r refresh`}
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      marginTop={1}
      onKey={(key) => {
        if (key.name === "r") return refresh(), true;
        // o is always one of collagen's own pages: a review's page, else this history at the merge
        if (key.name === "o") return current?.kind === "ticket" && current.ticket.kind === "review" ? openReviewPage({ ticketId: current.ticket.id }) : openPage(current ? { at: { project, number: current.merge.number } } : {}), true;
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
            {read && "base" in read ? <span fg={theme.dim}> into {read.base}</span> : null}
            {read && "none" in read ? <span fg={theme.dim}> · {read.none}</span> : null}
            {reading ? <span fg={theme.dim}> · reading…</span> : null}
          </text>
          {!reading && "merges" in read && lines.length === 0 ? (
            <text fg={theme.dim} truncate wrapMode="none">
              {"  "}none
            </text>
          ) : (
            <FollowScroll ref={list} follow={current ? (sel === 0 ? "start" : { id: count !== null && sel === last ? `more-${project}` : current.key }) : null} onWidth={setPane} flexGrow={1}>
              {lines.map((line) =>
                line.kind === "merge" ? (
                  <Merge key={line.key} id={line.key} merge={line.merge} info={infoOf(line.merge)} selected={focused && line.key === current?.key} lead={lead} infoWidth={info} />
                ) : line.kind === "more" ? (
                  <text key={line.key} id={line.key} fg={theme.dim} truncate wrapMode="none" flexShrink={0}>
                    {"    "}loading…
                  </text>
                ) : (
                  <Ticket key={line.key} id={line.key} ticket={line.ticket} last={line.last} author={nameFor(line.ticket.createdBy)} mine={line.ticket.createdBy === me} selected={focused && line.key === current?.key} />
                ),
              )}
            </FollowScroll>
          )}
        </>
      )}
    </Focusable>
  );
}
