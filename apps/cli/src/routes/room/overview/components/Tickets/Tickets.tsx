import { Fragment, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { excludedFromEpic, heldBy, ticketName, visibleTo, type Ticket } from "@collagen/p2p";
import { Focusable } from "../../../../../components/Focusable";
import { FollowScroll } from "../../../../../components/FollowScroll";
import { isEnter } from "../../../../../components/keys";
import { theme } from "../../../../../app/theme";
import { to, useRouter } from "../../../../../app/router";
import { clamp } from "../../../../../lib/math";
import { cells, clip, fitColumns } from "../../../../../lib/columns";
import { EPIC_MARK, GLYPH, KIND_GLYPH, LEGEND, STACK } from "../../../../../lib/glyphs";
import { atRest, epicProgress, marksLabel, progressShort, rowTitle, summarize, type TicketSummary } from "../../../../../lib/ticketSummary";
import { drawnOrder, epicBlocks, groupTickets, kindHeading, type EpicBlock, type Row } from "../../../../../lib/ticketGroups";
import { identityAtom, membersAtom, rosterAtom, traceAtom, unseenAtom } from "../../../atoms";
import { showClosedAtom, ticketTabAtom, ticketsAtom } from "./atoms";
import { closedLine, endedMark, fitTabs, relationsOf, relativesOf, TICKET_TABS, type Relative, type TicketTab } from "../../../../../lib/ticketTabs";
import { openReviewPageAtom } from "../../../review/atoms";

/** Shared tickets — every ticket the room has that its author has not
 *  closed, whoever made it and whoever it is for — or, on a kind's tab, the
 *  tickets of that kind, grouped by project. `h` lists the closed ones too,
 *  set apart below, each saying how it ended. Grouped by project (a
 *  header per project, left out when the room has one), then by kind in the
 *  order work moves through them — proposals, plans, bugs, reviews, tasks
 *  (lib/ticketGroups) — so a project reads as its pipeline. Inside a group,
 *  ordered by what wants a person: needs-you, then waiting, then failed,
 *  then finished-but-open (dim: every step answered, its author has not
 *  said it is over). A CLOSED ticket
 *  — the author's recorded decision, close-ticket — leaves this list and
 *  stays on the log with its steps as they were, where agents still read it
 *  and later tickets refer back to it. Nothing is deleted. ↑↓ select, enter
 *  opens the ticket's page. The `›` is the cursor, nothing else. */
export function Tickets() {
  const tickets = AsyncResult.getOrElse(useAtomValue(ticketsAtom), () => [] as const);
  const identity = AsyncResult.getOrElse(useAtomValue(identityAtom), () => null);
  const peers = AsyncResult.getOrElse(useAtomValue(rosterAtom), () => [] as const);
  const members = AsyncResult.getOrElse(useAtomValue(membersAtom), () => [] as const);
  const trace = AsyncResult.getOrElse(useAtomValue(traceAtom), () => [] as const);
  // what a newer collagen wrote here that this build cannot read: a ticket
  // among them gets a row of its own, the rest a count — both say to update
  const unseen = AsyncResult.getOrElse(useAtomValue(unseenAtom), () => [] as const);
  const unknownTickets = unseen.filter((record) => record.key.startsWith("ticket/"));
  const unseenOther = unseen.length - unknownTickets.length;
  const { navigate } = useRouter();
  const openReviewPage = useAtomSet(openReviewPageAtom);
  const [cursor, setCursor] = useState(0);
  // an epic shows its tickets until someone folds it, for this session
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  // the list's own width, once drawn: the columns are sized to it
  const [pane, setPane] = useState<number | undefined>(undefined);
  const tab = useAtomValue(ticketTabAtom);
  const setTab = useAtomSet(ticketTabAtom);
  const showClosed = useAtomValue(showClosedAtom);
  const setShowClosed = useAtomSet(showClosedAtom);

  const me = identity?.pubkey ?? "";
  const nameFor = (key: string): string =>
    key === me ? "you" : (peers.find((peer) => peer.key === key)?.name ?? members.find((member) => member.key === key)?.name ?? key.slice(0, 8));

  // every ticket the room has that is not over, grouped; the cursor walks
  // the rows in the order they are drawn, headers are not stops
  // a ticket waiting on another (after) is its author's alone until it opens
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const nameOf = (id: string): string | undefined => {
    const ticket = byId.get(id);
    return ticket ? ticketName(ticket) : undefined;
  };
  const visible = tickets.filter((ticket) => visibleTo(ticket, byId, me)).map((ticket) => ({ ticket, summary: summarize(ticket, trace, me, heldBy(ticket, byId, me), byId) }));
  const open = visible.filter((row) => row.summary.state !== "closed");
  const inTab = (row: Row) => tab === "all" || row.ticket.kind === tab;
  const rows = open.filter(inTab);
  // every ticket: open epics first, each holding its tickets, the rest by
  // project and kind; a kind's tab: by project alone, its epic said on the row
  const { epics, rest } = tab === "all" ? epicBlocks(rows, byId) : { epics: [] as ReadonlyArray<EpicBlock<Row>>, rest: rows };
  const groups = groupTickets(rest);
  // the closed ones, when asked for: set apart below, by project and kind
  const closedGroups = showClosed ? groupTickets(visible.filter((row) => row.summary.state === "closed" && inTab(row))) : [];
  const unfolded = new Set(epics.map((block) => block.epic.ticket.id).filter((id) => !folded.has(id)));
  // what a row is to the row above it, in its own column: a child under
  // the ticket it grew out of; else its epic (unless drawn inside it),
  // named whole — the column takes what the titles leave and cuts there
  const related = (ticket: Ticket, insideEpic: boolean, grew = false): ReadonlyArray<Part> => {
    if (grew) return [{ text: "child" }];
    const relations = relationsOf(ticket, byId, me);
    return relations.epic && !insideEpic ? [{ text: `${EPIC_MARK} ${relations.epic.name}` }] : [];
  };
  // its relatives not drawn where it is: dim rows under it, saying what each is to it
  const ghosts = (ticket: Ticket, here: ReadonlySet<string>): ReadonlyArray<Relative> => relativesOf(ticket, byId, me).filter((relative) => !here.has(relative.ticket.id));
  const idsOf = (list: ReadonlyArray<Row>): ReadonlySet<string> => new Set(list.map((row) => row.ticket.id));
  const epicHere = new Map(epics.map((block) => [block.epic.ticket.id, new Set([block.epic.ticket.id, ...block.rows.map((row) => row.ticket.id)])]));
  // every line the cursor stops on, in the order drawn: each epic and, unfolded,
  // its rows; the groups' rows; the closed ones — each row followed by its
  // relatives' rows. A relative is a stop too, so ↑↓ moves one line at a time
  // and the list scrolls a line at a time at its edges, never a block.
  const stops: Array<Stop> = [];
  const withGhosts = (row: Row, here: ReadonlySet<string>) => {
    stops.push({ key: row.ticket.id, ticket: row.ticket, row });
    for (const relative of ghosts(row.ticket, here)) stops.push({ key: ghostKey(row.ticket.id, relative.ticket.id), ticket: relative.ticket });
  };
  for (const block of epics) {
    stops.push({ key: block.epic.ticket.id, ticket: block.epic.ticket, row: block.epic });
    if (unfolded.has(block.epic.ticket.id)) for (const row of block.rows) withGhosts(row, epicHere.get(block.epic.ticket.id)!);
  }
  for (const group of groups) for (const kindGroup of group.kinds) for (const row of kindGroup.rows) withGhosts(row, idsOf(kindGroup.rows));
  for (const group of closedGroups) {
    const all = group.kinds.flatMap((kindGroup) => kindGroup.rows);
    for (const row of all) withGhosts(row, idsOf(all));
  }  const counts = new Map<TicketTab, number>(TICKET_TABS.map((ticketTab) => [ticketTab, ticketTab === "all" ? open.length : open.filter((row) => row.ticket.kind === ticketTab).length]));
  const needsYou = rows.filter((row) => row.summary.state === "needs-you").length;
  const projects = new Set(rows.filter((row) => row.ticket.kind !== "epic").map((row) => row.ticket.project));
  // one lead column for the whole list, as wide as its longest lead
  const width = leadWidth([
    ...epics.flatMap((block) => [
      // an epic's title starts a name's width before the rows' titles
      " ".repeat(Math.max(0, cells(rowTitle(block.epic.ticket)) + partsWidth(foldedParts(block, unfolded.has(block.epic.ticket.id))) + 3 * foldedParts(block, unfolded.has(block.epic.ticket.id)).length - KIND - NAME)),
      ...(unfolded.has(block.epic.ticket.id)
        ? block.rows.flatMap((row) => [leadOf(row.ticket, block.depth.get(row.ticket.id) ?? 0, projects.size > 1 ? row.ticket.project : undefined), ...ghosts(row.ticket, epicHere.get(block.epic.ticket.id)!).map((relative) => leadOf(relative.ticket, (block.depth.get(row.ticket.id) ?? 0) + 1, undefined))])
        : []),
    ]),
    ...groups.flatMap((group) => group.kinds.flatMap((kindGroup) => kindGroup.rows.flatMap((row) => [leadOf(row.ticket, kindGroup.depth.get(row.ticket.id) ?? 0, undefined), ...ghosts(row.ticket, idsOf(kindGroup.rows)).map((relative) => leadOf(relative.ticket, (kindGroup.depth.get(row.ticket.id) ?? 0) + 1, undefined))]))),
    ...closedGroups.flatMap((group) => group.kinds.flatMap((kindGroup) => kindGroup.rows.flatMap((row) => [leadOf(row.ticket, 0, undefined), ...ghosts(row.ticket, idsOf(group.kinds.flatMap((other) => other.rows))).map((relative) => leadOf(relative.ticket, 1, undefined))]))),
  ]);
  // then two info columns, each as wide as its widest: where a ticket stands
  // (marks, holds, an epic's progress, how a closed one ended), and apart
  // from it what the ticket hangs from
  const statusWidth = Math.max(
    0,
    ...epics.flatMap((block) => [
      cells(progressShort(epicProgress(block.epic.ticket, byId))),
      ...(unfolded.has(block.epic.ticket.id) ? block.rows.map((row) => partsWidth(rowInfo(row.summary, undefined, nameOf, excludedFromEpic(row.ticket)))) : []),
    ]),
    ...groups.flatMap((group) => group.kinds.flatMap((kindGroup) => kindGroup.rows.map((row) => partsWidth(rowInfo(row.summary, kindGroup.parent.get(row.ticket.id), nameOf, undefined))))),
    ...closedGroups.flatMap((group) => group.kinds.flatMap((kindGroup) => kindGroup.rows.map((row) => partsWidth(closedInfo(row.ticket))))),
    ...[...groups, ...closedGroups].flatMap((group) => group.kinds.flatMap((kindGroup) => kindGroup.rows.flatMap((row) => relativesOf(row.ticket, byId, me).map((relative) => cells(ghostStatus(relative.ticket)))))),
    ...epics.flatMap((block) => block.rows.flatMap((row) => relativesOf(row.ticket, byId, me).map((relative) => cells(ghostStatus(relative.ticket))))),
  );
  const relationWidth = Math.max(
    0,
    ...epics.flatMap((block) => (unfolded.has(block.epic.ticket.id) ? block.rows.map((row) => partsWidth(related(row.ticket, true, block.grew.has(row.ticket.id)))) : [])),
    ...[...groups, ...closedGroups].flatMap((group) => group.kinds.flatMap((kindGroup) => kindGroup.rows.map((row) => partsWidth(related(row.ticket, false, kindGroup.grew.has(row.ticket.id)))))),
    // a relative's row says "parent" or "child"
    ...[...epics.flatMap((block) => block.rows), ...[...groups, ...closedGroups].flatMap((group) => group.kinds.flatMap((kindGroup) => kindGroup.rows))].flatMap((row) => relativesOf(row.ticket, byId, me).map((relative) => cells(relative.as))),
  );
  const infoWidth = statusWidth + relationWidth + (statusWidth > 0 && relationWidth > 0 ? GAP : 0);
  // both bounded by the pane, as it is drawn: the titles first, the info in
  // what is left (lib/columns), truncated inside it
  const indent = groups.length > 1 || closedGroups.length > 1 ? 4 : 2;
  const { lead: leadCol, info: infoCol } = fitColumns({ lead: width, info: infoWidth }, pane === undefined ? undefined : pane - (indent - 2 + HEAD + NAME) - GAP);
  // the status keeps its column whole; what the ticket hangs from gets the rest
  const statusCol = Math.min(statusWidth, infoCol);
  const relationCol = Math.max(0, infoCol - statusCol - (statusCol > 0 ? GAP : 0));
  const index = new Map(stops.map((stop, position) => [stop.key, position]));
  const on = (key: string): boolean => index.get(key) === sel;

  const last = Math.max(0, stops.length - 1);
  const sel = clamp(cursor, 0, last);
  const current = stops[sel];
  const currentId = current?.key;

  return (
    <box flexDirection="column" marginTop={1} flexShrink={1} minHeight={0}>
    <KindTabs tab={tab} counts={counts} extra={unknownTickets.length} needsYou={needsYou > 0} width={pane} onTab={(nextTab) => (setTab(nextTab), setCursor(0))} />
    <Focusable
      id="tickets"
      hint={`↑↓ select · enter open${current?.ticket.kind === "epic" ? ` · space ${unfolded.has(current.ticket.id) ? "fold" : "unfold"}` : ""}${current?.ticket.kind === "review" ? " · o in browser" : ""} · ${LEGEND} · ? the rest`}
      flexDirection="column"
      flexShrink={1}
      minHeight={0}
      onKey={(key) => {
        if (key.name === "up" && sel > 0) return setCursor(sel - 1), true;
        if (key.name === "down" && sel < last) return setCursor(sel + 1), true;
        if (isEnter(key)) {
          if (current) navigate(to.ticket(current.ticket.id));
          return true;
        }
        // an epic folds and unfolds where it stands
        if (key.name === "space" && current?.row && current.ticket.kind === "epic") {
          const id = current.ticket.id;
          setFolded((previous) => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
          return true;
        }
        // straight from the list to the diff read by intent, in the browser
        if (key.name === "o" && current?.ticket.kind === "review") return openReviewPage({ ticketId: current.ticket.id }), true;
        // the closed ones, shown or not
        if (key.name === "h") return setShowClosed(!showClosed), true;
        // one key to what a ticket hangs from
        if (current && (key.name === "e" || key.name === "p")) {
          const relations = relationsOf(current.ticket, byId, me);
          const target = key.name === "e" ? relations.epic : relations.parent;
          if (target) navigate(to.ticket(target.id));
          return true;
        }
        return false;
      }}
    >
      {(focused) => (
        <>
          {stops.length === 0 && !showClosed && (unknownTickets.length === 0 || tab !== "all") ? (
            <text fg={theme.dim} truncate wrapMode="none" marginTop={1}>
              {"  "}none
            </text>
          ) : (
            // the rows scroll inside the pane, the cursor's row kept in view;
            // at the first row all the way up, so what heads the list shows
            <FollowScroll follow={currentId ? (sel === 0 ? "start" : { id: rowId(currentId) }) : null} onWidth={setPane}>
            {epics.map((block) => (
              <EpicView
                key={block.epic.ticket.id}
                block={block}
                open={unfolded.has(block.epic.ticket.id)}
                first={epics[0] === block}
                indent={indent}
                width={leadCol}
                infoWidth={statusCol}
                relationWidth={relationCol}
                selectedKey={focused ? current?.key : undefined}
                progress={progressShort(epicProgress(block.epic.ticket, byId))}
                nameFor={nameFor}
                projects={projects.size > 1}
                goalOf={nameOf}
                related={(ticket) => related(ticket, true, block.grew.has(ticket.id))}
                ghosts={(ticket) => ghosts(ticket, epicHere.get(block.epic.ticket.id)!)}
              />
            ))}
            {groups.map((group, groupIndex) => (
              // a line between the tabs and the rows, as an open epic has above it
              <box key={group.project} flexDirection="column" flexShrink={0} marginTop={groupIndex === 0 && epics.length === 0 ? 1 : 0}>
                {groups.length > 1 ? (
                  <text fg={theme.fg} truncate wrapMode="none">
                    {"  "}
                    {group.project}
                  </text>
                ) : null}
                {group.kinds.map((kindGroup) => (
                  <box key={kindGroup.kind} flexDirection="column" flexShrink={0}>
                    {/* on a kind's tab the tab says the kind: no heading for it */}
                    {tab === "all" ? (
                      <text fg={theme.dim} truncate wrapMode="none">
                        {groups.length > 1 ? "    " : "  "}
                        {kindHeading(kindGroup.kind)}
                      </text>
                    ) : null}
                    {kindGroup.rows.map((row) => (
                      <Fragment key={row.ticket.id}>
                        <TicketRow
                          ticket={row.ticket}
                          summary={row.summary}
                          selected={focused && on(row.ticket.id)}
                          nameFor={nameFor}
                          indent={indent}
                          depth={kindGroup.depth.get(row.ticket.id) ?? 0}
                          under={kindGroup.parent.get(row.ticket.id)}
                          goalOf={nameOf}
                          width={leadCol}
                          infoWidth={statusCol}
                          relationWidth={relationCol}
                          related={related(row.ticket, false, kindGroup.grew.has(row.ticket.id))}
                        />
                        {ghosts(row.ticket, idsOf(kindGroup.rows)).map((relative) => (
                          <GhostRow key={relative.ticket.id} id={rowId(ghostKey(row.ticket.id, relative.ticket.id))} selected={focused && on(ghostKey(row.ticket.id, relative.ticket.id))} relative={relative} nameFor={nameFor} indent={indent} depth={(kindGroup.depth.get(row.ticket.id) ?? 0) + 1} width={leadCol} infoWidth={statusCol} relationWidth={relationCol} />
                        ))}
                      </Fragment>
                    ))}
                  </box>
                ))}
              </box>
            ))}
            {showClosed ? (
              <box flexDirection="column" flexShrink={0} marginTop={1}>
                <text fg={theme.dim} truncate wrapMode="none">
                  {"  "}closed{closedGroups.length === 0 ? "   none" : ""}
                </text>
                {closedGroups.map((group) => (
                  <box key={group.project} flexDirection="column" flexShrink={0}>
                    {closedGroups.length > 1 ? (
                      <text fg={theme.dim} truncate wrapMode="none">
                        {"    "}
                        {group.project}
                      </text>
                    ) : null}
                    {group.kinds.flatMap((kindGroup) => kindGroup.rows).map((row, _, all) => (
                      <Fragment key={row.ticket.id}>
                        <TicketRow
                          ticket={row.ticket}
                          summary={row.summary}
                          selected={focused && on(row.ticket.id)}
                          nameFor={nameFor}
                          indent={indent}
                          depth={0}
                          under={undefined}
                          goalOf={nameOf}
                          width={leadCol}
                          infoWidth={statusCol}
                          relationWidth={relationCol}
                          info={closedInfo(row.ticket)}
                          related={related(row.ticket, false)}
                        />
                        {ghosts(row.ticket, idsOf(all)).map((relative) => (
                          <GhostRow key={relative.ticket.id} id={rowId(ghostKey(row.ticket.id, relative.ticket.id))} selected={focused && on(ghostKey(row.ticket.id, relative.ticket.id))} relative={relative} nameFor={nameFor} indent={indent} depth={1} width={leadCol} infoWidth={statusCol} relationWidth={relationCol} />
                        ))}
                      </Fragment>
                    ))}
                  </box>
                ))}
              </box>
            ) : null}
            </FollowScroll>
          )}
          {unknownTickets.map((record) => (
            <text key={record.key} fg={theme.dim} truncate wrapMode="none">
              {"        "}
              {"unknown".padEnd(9)}update collagen to see this ticket
            </text>
          ))}
          {unseenOther > 0 ? (
            <text fg={theme.dim} truncate wrapMode="none">
              {"  "}
              {unseenOther} more record{unseenOther === 1 ? "" : "s"} here need{unseenOther === 1 ? "s" : ""} a newer collagen
            </text>
          ) : null}
        </>
      )}
    </Focusable>
    </box>
  );
}

/** The list's tabs: every ticket, then one per kind — each with its glyph,
 *  so the glyphs on the rows are learned here, and how many are open. A
 *  section like the room's tab bar: hover it, ←→ switch, ↓ into the list,
 *  which shows only that tab's tickets. */
function KindTabs({ tab, counts, extra, needsYou, width, onTab }: { tab: TicketTab; counts: ReadonlyMap<TicketTab, number>; extra: number; needsYou: boolean; width: number | undefined; onTab: (tab: TicketTab) => void }) {
  // the row fits the pane, the open tab always whole (lib/ticketTabs)
  const shown = fitTabs(tab, new Map([...counts].map(([ticketTab, count]) => [ticketTab, count + (ticketTab === "all" ? extra : 0)])), width === undefined ? undefined : width - 2);
  return (
    <Focusable
      id="ticket-tabs"
      flexShrink={0}
      hint="←→ switch tab · ↓ into its tickets"
      onKey={(key) => {
        const index = TICKET_TABS.indexOf(tab);
        if (key.name === "left" && index > 0) return onTab(TICKET_TABS[index - 1]!), true;
        if (key.name === "right" && index < TICKET_TABS.length - 1) return onTab(TICKET_TABS[index + 1]!), true;
        // ← past the first and → past the last are not ours: the rail, the projects
        return false;
      }}
    >
      {(focused) => (
        <text wrapMode="none">
          <span fg={focused ? theme.accent : theme.dim}>{focused ? "› " : "  "}</span>
          {shown.before ? <span fg={theme.dim}>{"‹ "}</span> : null}
          {shown.tabs.flatMap((shownTab, index) => {
            const count = counts.get(shownTab.tab) ?? 0;
            return [
              ...(index > 0 ? [<span key={`${shownTab.tab}-gap`}>{" ".repeat(shown.gap)}</span>] : []),
              <span key={shownTab.tab} fg={shownTab.open ? (focused ? theme.accent : theme.fg) : count === 0 && shownTab.tab !== "all" ? theme.dim : theme.fg}>
                {shownTab.text.slice(0, shownTab.text.lastIndexOf(" "))}
              </span>,
              <span key={`${shownTab.tab}-n`} fg={shownTab.open && needsYou ? theme.warn : theme.dim}>{shownTab.text.slice(shownTab.text.lastIndexOf(" "))}</span>,
            ];
          })}
          {shown.after ? <span fg={theme.dim}>{" ›"}</span> : null}
        </text>
      )}
    </Focusable>
  );
}

/** An open epic, set apart by space above and below: one purple row — the
 *  crown, its title, how far along its tickets are, and the ▸ when a ticket
 *  inside is yours now — and under it, in their own colours, the tickets
 *  that are in it, each with its project when the room has more than one.
 *  Folded (space), the row says how many are tucked away. */
function EpicView({
  block,
  open,
  first,
  selectedKey,
  progress,
  nameFor,
  projects,
  goalOf,
  indent,
  width,
  infoWidth,
  relationWidth,
  related,
  ghosts,
}: {
  block: EpicBlock<Row>;
  open: boolean;
  first: boolean;
  /** the columns before the cursor that every other row has, so the crown
   *  sits on the headings' column and the title on the names' */
  indent: number;
  /** the cursor's line: a ticket's id, or a relative's ghostKey */
  selectedKey: string | undefined;
  progress: string;
  nameFor: (key: string) => string;
  projects: boolean;
  goalOf: (ticketId: string) => string | undefined;
  /** the rows' lead width, so the epic's progress sits on their status column */
  width: number;
  infoWidth: number;
  relationWidth: number;
  /** what a row inside hangs from besides this epic */
  related: (t: Ticket) => ReadonlyArray<Part>;
  /** a row's relatives not in this epic, drawn dim under it */
  ghosts: (t: Ticket) => ReadonlyArray<Relative>;
}) {
  const selected = selectedKey === block.epic.ticket.id;
  return (
    <box flexDirection="column" flexShrink={0} marginTop={first ? 1 : 0} marginBottom={1}>
      <box id={rowId(block.epic.ticket.id)} flexDirection="row" flexShrink={0}>
        <text wrapMode="none" flexShrink={0}>
          {" ".repeat(Math.max(0, indent - 2))}
          <span fg={selected ? theme.accent : theme.epic}>{selected ? "› " : "  "}</span>
          <span fg={theme.epic}>{EPIC_MARK} </span>
        </text>
        {/* the title starts on the tree's column, before the glyphs and the
            names: its column is that much wider than the rows' titles */}
        <text fg={theme.epic} truncate wrapMode="none" flexBasis={width + KIND + NAME} flexShrink={1} minWidth={0}>
          {rowTitle(block.epic.ticket)}
          {foldedParts(block, open).map((part) => (
            <span key={part.text} fg={part.warn ? theme.warn : theme.dim}>
              {" · "}
              {part.text}
            </span>
          ))}
        </text>
        <Info parts={[{ text: progress }]} width={infoWidth} />
      </box>
      {open
        ? block.rows.map((row, index) => {
            const last = index === block.rows.length - 1;
            return (
              <Fragment key={row.ticket.id}>
                <TicketRow
                  ticket={row.ticket}
                  summary={row.summary}
                  selected={selectedKey === row.ticket.id}
                  nameFor={nameFor}
                  indent={indent}
                  depth={block.depth.get(row.ticket.id) ?? 0}
                  under={block.parent.get(row.ticket.id)}
                  goalOf={goalOf}
                  project={projects ? row.ticket.project : undefined}
                  excluded={excludedFromEpic(row.ticket)}
                  related={related(row.ticket)}
                  branch={last ? "last" : "mid"}
                  width={width}
                  infoWidth={infoWidth}
                  relationWidth={relationWidth}
                />
                {ghosts(row.ticket).map((relative) => (
                  <GhostRow key={relative.ticket.id} id={rowId(ghostKey(row.ticket.id, relative.ticket.id))} selected={selectedKey === ghostKey(row.ticket.id, relative.ticket.id)} relative={relative} nameFor={nameFor} indent={indent} depth={(block.depth.get(row.ticket.id) ?? 0) + 1} pipe={!last} width={width} infoWidth={infoWidth} relationWidth={relationWidth} />
                ))}
              </Fragment>
            );
          })
        : null}
    </box>
  );
}

/** Before the name, on every row: the cursor, the ▸, the tree, the glyph —
 *  two columns each. */
const HEAD = 8;
/** The most a waiting row spends naming what it waits on. */
const AFTER_MAX = 24;

/** A closed row's status: how it ended. */
const closedInfo = (ticket: Ticket): ReadonlyArray<Part> => [{ text: closedLine(ticket) ?? "closed" }];

/** Between the title and the info column. */
const GAP = 2;

/** The name column: eight letters and a space. */
const NAME = 9;
/** Between the tree's column and the name: the kind's glyph and a space each side. */
const KIND = 4;

/** What a row says before its info column: the staircase, the project
 *  (inside an epic) and the title — the text the info column aligns after. */
const staircase = (depth: number): string => (depth > 0 ? `${"  ".repeat(Math.min(depth, 6) - 1)}${STACK.follows} ` : "");
const leadOf = (ticket: Ticket, depth: number, project: string | undefined): string => `${staircase(depth)}${project ? `${project} · ` : ""}${rowTitle(ticket)}`;

/** The columns a list's lead takes: the longest one shown (a title is 60 at
 *  most), so the info column sits just past it on every row. */
const leadWidth = (leads: ReadonlyArray<string>): number => Math.max(0, ...leads.map(cells));

/** What follows a row's title, in the info column. */
type Part = { readonly text: string; readonly warn?: boolean };
const partsWidth = (parts: ReadonlyArray<Part>): number => parts.reduce((total, part, index) => total + cells(part.text) + (index > 0 ? 3 : 0), 0);

/** A ticket's info: out of its epic's progress, what holds it, what was said on it. */
const rowInfo = (
  summary: TicketSummary,
  under: string | undefined,
  goalOf: (ticketId: string) => string | undefined,
  excluded: boolean | undefined,
): ReadonlyArray<Part> => {
  // waiting on the row it is drawn under says so in one word; waiting on one
  // elsewhere (another group, or a second of two) names it
  const elsewhere = summary.held.filter((id) => id !== under);
  const on = elsewhere.length > 0 ? clip(goalOf(elsewhere[0]!) ?? elsewhere[0]!.slice(0, 8), AFTER_MAX) : "";
  const people = marksLabel(summary);
  return [
    ...(excluded ? [{ text: "excluded" }] : []),
    ...(summary.held.length > 0 ? [{ text: `${on ? `${STACK.waits} after "${on}"` : `${STACK.waits} waiting`}${elsewhere.length > 1 ? ` +${elsewhere.length - 1}` : ""}` }] : []),
    ...(people.length > 0 ? [{ text: people, warn: summary.state === "needs-you" }] : []),
  ];
};

/** Folded, an epic says after its title how many it holds and how many are
 *  yours — there is room beside a title, and its info column keeps the progress. */
const foldedParts = (block: EpicBlock<Row>, open: boolean): ReadonlyArray<Part> => {
  const yours = block.rows.filter((row) => row.summary.state === "needs-you").length;
  return [
    ...(!open && block.rows.length > 0 ? [{ text: `${block.rows.length} folded` }] : []),
    ...(!open && yours > 0 ? [{ text: `${GLYPH.yours} ${yours} yours`, warn: true }] : []),
  ];
};

/** The info column: two past the longest title on screen, and as wide as
 *  the widest info — so when the list is narrower than both, every title
 *  gives up the same columns and the info still starts on one line. (A
 *  title's column is a flexBasis, not a width: OpenTUI turns flexShrink off
 *  when a numeric width is set after mount, and the title would stop giving
 *  way the first time the column changed — on a fold, say.) */
function Info({ parts, width }: { parts: ReadonlyArray<Part>; width: number }) {
  if (width === 0) return null;
  // cut at the end, where the reader stops, not in the middle: what comes
  // first (the kind of hold, the first mark) is what has to show
  const fitted: Array<Part> = [];
  let left = width;
  for (const part of parts) {
    const text = `${fitted.length > 0 ? " · " : ""}${part.text}`;
    if (left <= 0) break;
    fitted.push({ ...part, text: clip(text, left) });
    left -= cells(text);
  }
  return (
    <text wrapMode="none" flexBasis={width} flexShrink={0} marginLeft={GAP}>
      {fitted.map((part, index) => (
        <span key={index} fg={part.warn ? theme.warn : theme.dim}>
          {part.text}
        </span>
      ))}
    </text>
  );
}

/** A relative's row says only whether it is over, and how: what it is to the row above is its other column. */
const ghostStatus = (ticket: Ticket): string => endedMark(ticket) ?? "";

/** A ticket's relative that is not drawn where it is — closed, in another
 *  epic, of another kind's tab — one level under it, dim: what it is to the
 *  row above ("parent", "child") in the relation column. A stop for the
 *  cursor like any row; enter opens it. */
function GhostRow({
  id,
  selected,
  relative: { ticket, as },
  nameFor,
  indent,
  depth,
  pipe,
  width,
  infoWidth,
  relationWidth,
}: {
  id: string;
  selected: boolean;
  relative: Relative;
  nameFor: (key: string) => string;
  indent: number;
  depth: number;
  /** inside an epic, under a row that is not its last: the tree goes on past it */
  pipe?: boolean;
  width: number;
  infoWidth: number;
  relationWidth: number;
}) {
  const status = ghostStatus(ticket);
  const color = selected ? theme.accent : theme.dim;
  return (
    <box id={id} flexDirection="row" flexShrink={0}>
      <text fg={color} wrapMode="none" flexShrink={0}>
        {" ".repeat(Math.max(0, indent - 2))}
        {selected ? "› " : "  "}
        {"  "}
        {pipe ? <span fg={theme.epic}>│ </span> : "  "}
        {ticket.kind === "epic" ? "  " : `${KIND_GLYPH[ticket.kind]} `}
        {nameFor(ticket.createdBy).slice(0, NAME - 1).padEnd(NAME)}
      </text>
      <text fg={color} truncate wrapMode="none" flexBasis={width} flexShrink={1} minWidth={0}>
        {staircase(depth)}
        {rowTitle(ticket)}
      </text>
      <Info parts={status ? [{ text: status }] : []} width={infoWidth} />
      <Info parts={[{ text: as }]} width={relationWidth} />
    </box>
  );
}

/** A cursor stop: a ticket's own row, or a relative drawn under one. */
type Stop = { readonly key: string; readonly ticket: Ticket; readonly row?: Row };

/** A relative's line, by the row it hangs under: one ticket can be a dim row under several. */
const ghostKey = (host: string, id: string): string => `${host}>${id}`;

/** The id a ticket's row is drawn under, so the list can keep it in view. */
const rowId = (ticketId: string): string => `row-${ticketId}`;

/** One ticket at a glance: whose it is, what it is about, and what has been
 *  said on it — `↻` changes were asked for, `✓` someone approved, one glyph
 *  per kind of answer however many gave it (lib/glyphs, spelled out on `?`).
 *  Not who said it: that is the ticket page's job. Its kind is the header
 *  it sits under.
 *
 *  The first column is whose it is — "you" bright when this person started
 *  the ticket, the author's name dim when somebody else did — and it keeps
 *  that colour under the cursor: "mine or theirs" is the first thing the eye
 *  asks of a list, and the answer should not move when the selection does.
 *  (It held the kind until the kinds became headers.) Nothing else: the
 *  ticket's own page has the rest, and an agent can read all of it. */
function TicketRow({
  ticket,
  summary,
  selected,
  nameFor,
  indent,
  depth,
  under,
  goalOf,
  project,
  excluded,
  branch,
  width,
  infoWidth,
  relationWidth,
  related = [],
  info,
}: {
  ticket: Ticket;
  summary: TicketSummary;
  selected: boolean;
  nameFor: (key: string) => string;
  /** columns before the cursor, so a row sits under its header */
  indent: number;
  /** levels under the ticket it is read after, in its group (0: none) */
  depth: number;
  /** the ticket it is drawn under, when it is */
  under: string | undefined;
  goalOf: (ticketId: string) => string | undefined;
  /** its project, said before its goal — inside an epic, which spans them */
  project?: string;
  /** in its epic but out of its progress */
  excluded?: boolean;
  /** inside an epic: its line of the tree, under the epic's title */
  branch?: "mid" | "last";
  /** the lead column's width: the info after it starts on the same column on every row */
  width: number;
  /** the status column's width, the widest status on screen */
  infoWidth: number;
  /** the column after it: what the ticket hangs from */
  relationWidth: number;
  /** what it hangs from, said last and quietly */
  related?: ReadonlyArray<Part>;
  /** the status in place of its own (a closed row's: how it ended) */
  info?: ReadonlyArray<Part>;
}) {
  const yours = summary.state === "needs-you";
  // waiting on another ticket: only its author sees the row, dim, saying on what
  const dim = atRest(summary) || summary.held.length > 0 || excluded === true;
  const color = selected ? theme.accent : dim ? theme.dim : theme.fg;
  return (
    <box id={rowId(ticket.id)} flexDirection="row" flexShrink={0}>
      <text fg={color} wrapMode="none" flexShrink={0}>
        {" ".repeat(Math.max(0, indent - 2))}
        {selected ? "› " : "  "}
        {/* the row's own mark: it is yours to act on. Carried here and not only
            in the people's colour, because on your own ticket the people list can
            be empty — and then a change request had no trace on screen at all.
            Same column on every row, an epic's tickets too */}
        <span fg={theme.warn}>{yours ? `${GLYPH.yours} ` : "  "}</span>
        {/* inside an epic, its line of the tree, dropping from the first
            letter of the epic's title; a blank of that width on every other
            row, so the glyphs and the names keep one column throughout */}
        {branch ? <span fg={theme.epic}>{branch === "last" ? "└ " : "├ "}</span> : "  "}
        {/* every row's kind, as a glyph: under a heading it learns what it
            means, and inside an epic — no headings there — it says it */}
        <span fg={theme.dim}>{ticket.kind === "epic" ? "  " : `${KIND_GLYPH[ticket.kind]} `}</span>
        <span fg={summary.mine ? theme.accent : theme.dim}>{nameFor(ticket.createdBy).slice(0, NAME - 1).padEnd(NAME)}</span>
      </text>
      <text fg={color} truncate wrapMode="none" flexBasis={width} flexShrink={1} minWidth={0}>
        {/* a staircase: two columns a level, capped so a long chain keeps its goals readable */}
        {depth > 0 ? <span fg={theme.dim}>{staircase(depth)}</span> : null}
        {project ? <span fg={theme.dim}>{project} · </span> : null}
        {ticket.title ? ticket.title : <span fg={theme.dim}>{rowTitle(ticket)}</span>}
      </text>
      <Info parts={info ?? rowInfo(summary, under, goalOf, excluded)} width={infoWidth} />
      <Info parts={related} width={relationWidth} />
    </box>
  );
}
