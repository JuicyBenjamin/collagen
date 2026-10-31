import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { JobKind, LocalState, MergeFor, Steering } from "@collagen/p2p";
import { useRouter } from "../../app/router";
import { clip } from "../../lib/columns";
import { theme } from "../../app/theme";
import { FollowScroll } from "../../components/FollowScroll";
import { SETTINGS, settingOf, withSetting } from "../../lib/settings";
import { MERGE_HELP, MERGE_LEVELS, withMergeFor } from "../../lib/merging";
import { levelOf, masterOf, roomLevelOf, STEERING_HELP, STEERING_LABEL, STEERING_ORDER, KIND_LABEL, TAG_LABEL, tagRouteOf, withLevel, withTagRoute, type Cause, type SteeringAt } from "../../lib/steering";
import { JOB_LABEL, jobLimitOf, mostUsedHarness, withHarness, withModel } from "../../lib/jobs";
import { roomAtom } from "../atoms";
import { aiChoicesAtom, stateAtom, updateStateAtom } from "../room/atoms";
import { CAUSE_WORDS, pickable, TAG_CHOICES, ROWS, STEER_WORDS, TABS, TAG_WORDS, twoColumns, type Row, type Tab } from "./rows";

/** The width of a row's words, and of each column after them. */
const WORDS = 28;
/** A steering row's name, before whose doing it is. */
const KIND = 16;
const COLUMN = 16;
/** The job limit round: 1 → 4 and back. */
const JOB_LIMITS = [1, 2, 3, 4];

/** A round of levels: not chosen first (following the general level, or —
 *  in a room — everywhere), then up from never. */
const nextLevel = (level: Steering | undefined): Steering | null => {
  const order: ReadonlyArray<Steering | null> = [null, ...STEERING_ORDER];
  return order[(order.indexOf(level ?? null) + 1) % order.length]!;
};
const everywhereOf = (state: LocalState | null, at: SteeringAt, cause: Cause): Steering | undefined =>
  at === "master" ? state?.steering?.master?.[cause] : state?.steering?.kinds?.[at]?.[cause];
const nextMerge = (level: MergeFor | undefined, allowNone: boolean): MergeFor | null => {
  const order: ReadonlyArray<MergeFor | null> = allowNone ? [null, ...MERGE_LEVELS] : MERGE_LEVELS;
  return order[(order.indexOf(level ?? (allowNone ? null : "off")) + 1) % order.length]!;
};
const cell = (text: string) => text.padEnd(COLUMN).slice(0, COLUMN);

/** Settings: what collagen may do in your name, everywhere and in the room
 *  you are in, by who acts — your AI, or tools collagen calls itself with no
 *  AI — and the general level the rest follow. Each change applies the moment
 *  it is made (your agent can make them too: set-steering, set-jobs,
 *  set-settings, set-merging). */
export function SettingsPage() {
  const room = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" }));
  const { navigate } = useRouter();
  const state = AsyncResult.getOrElse(useAtomValue(stateAtom), () => null);
  const choices = AsyncResult.getOrElse(useAtomValue(aiChoicesAtom), (): ReadonlyArray<string | null> => [null]);
  const updateState = useAtomSet(updateStateAtom);
  const [tab, setTab] = useState<Tab>(TABS[0]!.id);
  const rows = ROWS[tab];
  const [cursor, setCursor] = useState(() => ROWS[TABS[0]!.id].findIndex(pickable));
  const [column, setColumn] = useState<0 | 1>(0);
  // on the tab bar, as in the room: ↑ from the first row reaches it, ←→ switch tabs there
  const [onBar, setOnBar] = useState(false);
  const [models, setModels] = useState<Partial<Record<JobKind, string>>>({});
  const row = rows[Math.min(cursor, rows.length - 1)]!;
  const used = state ? mostUsedHarness(state) : null;

  const first = rows.findIndex(pickable);
  const move = (by: 1 | -1) => {
    if (by === -1 && cursor === first) return setOnBar(true);
    let next = cursor;
    do next = (next + by + rows.length) % rows.length;
    while (!pickable(rows[next]!));
    setCursor(next);
  };
  const showTab = (next: Tab) => {
    setTab(next);
    setCursor(ROWS[next].findIndex(pickable));
    setColumn(0);
  };
  const switchTab = (by: 1 | -1) => showTab(TABS[(TABS.findIndex((each) => each.id === tab) + by + TABS.length) % TABS.length]!.id);

  const change = (update: (previous: LocalState) => LocalState) => updateState({ update });
  /** space or enter on the cell under the cursor */
  const act = () => {
    const here = column === 1 && twoColumns(row);
    if (row.kind === "steer")
      return change((previous) =>
        here ? withLevel(previous, row.at, row.cause, nextLevel(roomLevelOf(previous, room.id, row.at, row.cause)), room.id) : withLevel(previous, row.at, row.cause, nextLevel(everywhereOf(previous, row.at, row.cause))),
      );
    if (row.kind === "merge")
      return change((previous) => (here ? withMergeFor(previous, { room: room.id }, nextMerge(previous.merging?.rooms?.[room.id], true)) : withMergeFor(previous, { default: true }, nextMerge(previous.merging?.default, false))));
    if (row.kind === "tag") return change((previous) => withTagRoute(previous, TAG_CHOICES[(TAG_CHOICES.indexOf(tagRouteOf(previous)) + 1) % TAG_CHOICES.length]!));
    if (row.kind === "switch") return change((previous) => withSetting(previous, row.key, !settingOf(previous, row.key)));
    if (row.kind === "jobLimit") return change((previous) => ({ ...previous, jobLimit: JOB_LIMITS[(JOB_LIMITS.indexOf(jobLimitOf(previous)) + 1) % JOB_LIMITS.length]! }));
    if (row.kind === "harness") {
      const round: ReadonlyArray<string | null> = [null, ...choices.filter((choice): choice is string => choice !== null)];
      return change((previous) => withHarness(previous, row.job, round[(round.indexOf(previous.harnesses?.[row.job] ?? null) + 1) % round.length] ?? null));
    }
  };

  useKeyboard((key) => {
    if (key.name === "escape") return navigate("room/overview");
    if (key.name === "tab") return switchTab(key.shift ? -1 : 1);
    if (onBar) {
      if (key.name === "left") return switchTab(-1);
      if (key.name === "right") return switchTab(1);
      if (key.name === "down" || key.name === "return" || key.name === "enter") return setOnBar(false);
    }
    // a tab by its number, from anywhere but a model being typed
    const numbered = row.kind === "model" && !onBar ? undefined : TABS[Number(key.name) - 1];
    if (numbered) return showTab(numbered.id);
    if (onBar) return;
    if (key.name === "down") return move(1);
    if (key.name === "up") return move(-1);
    // typing a model: the arrows and space are the field's
    if (row.kind === "model") return;
    if (key.name === "left") return setColumn(0);
    if (key.name === "right") return setColumn(twoColumns(row) ? 1 : 0);
    if (key.name === "space" || key.name === "return" || key.name === "enter") return act();
  });

  /** One cell: the level that applies there, and whether it is set there
   *  (bright) or taken from above it — the General tab, or everywhere (dim). */
  const steerCell = (at: SteeringAt, cause: Cause, here: boolean): { readonly text: string; readonly set: boolean } => {
    const known = state ?? { steering: undefined };
    const roomId = here ? room.id : undefined;
    const applies = at === "master" ? masterOf(known, cause, roomId) : levelOf(known, at, cause, roomId);
    const set = here ? roomLevelOf(known, room.id, at, cause) !== undefined : everywhereOf(state, at, cause) !== undefined;
    return { text: STEERING_LABEL[applies], set };
  };

  const line = (each: Row, index: number) => {
    const on = !onBar && index === cursor;
    const mark = (col: 0 | 1, set = true) => (on && column === col ? theme.accent : set ? theme.fg : theme.dim);
    const words = (text: string) => <span fg={on ? theme.accent : theme.fg}>{`${on ? "› " : "  "}${text}`.padEnd(WORDS).slice(0, WORDS)}</span>;
    switch (each.kind) {
      case "heading":
        return (
          <text key={each.id} id={each.id} fg={theme.fg}>
            {each.text}
          </text>
        );
      case "label":
        return (
          <text key={each.id} id={each.id} fg={theme.fg} wrapMode="none">
            {`  ${each.text}`}
          </text>
        );
      case "space":
        return <text key={each.id} id={each.id}>{" "}</text>;
      case "columns":
        return (
          <text key={each.id} id={each.id} fg={theme.dim} wrapMode="none">
            {"".padEnd(WORDS)}
            {cell("everywhere")}
            {/* the room the second column is for, by its name: the last column, so it may run long */}
            {room.name ? `in ${clip(room.name, 40)}` : "this room"}
          </text>
        );
      case "note":
        return (
          <text key={each.id} id={each.id} fg={theme.dim}>
            {`${" ".repeat(each.indent ?? 0)}${each.text}`}
          </text>
        );
      case "steer": {
        const everywhere = steerCell(each.at, each.cause, false);
        const here = steerCell(each.at, each.cause, true);
        return (
          <text key={each.id} id={each.id} wrapMode="none">
            {words(`${(each.cause === "mine" ? STEER_WORDS[each.at] : "").padEnd(KIND)}${CAUSE_WORDS[each.cause]}`)}
            <span fg={mark(0, everywhere.set)}>{cell(everywhere.text)}</span>
            <span fg={mark(1, here.set)}>{cell(here.text)}</span>
          </text>
        );
      }
      case "merge": {
        const mergeRoom = state?.merging?.rooms?.[room.id];
        return (
          <text key={each.id} id={each.id} wrapMode="none">
            {words("auto-merge")}
            <span fg={mark(0)}>{cell(state?.merging?.default ?? "off")}</span>
            <span fg={mark(1, mergeRoom !== undefined)}>{cell(mergeRoom ?? state?.merging?.default ?? "off")}</span>
          </text>
        );
      }
      case "tag":
        return (
          <text key={each.id} id={each.id} wrapMode="none">
            {words("  go to")}
            <span fg={mark(0)}>{TAG_WORDS[state ? tagRouteOf(state) : "existing"]}</span>
          </text>
        );
      case "switch": {
        const setting = SETTINGS.find((candidate) => candidate.key === each.key)!;
        return (
          <text key={each.id} id={each.id} wrapMode="none">
            {words(each.name ?? setting.label)}
            <span fg={mark(0)}>{state && settingOf(state, each.key) ? (each.says?.on ?? "on") : (each.says?.off ?? "off")}</span>
          </text>
        );
      }
      case "jobLimit":
        return (
          <text key={each.id} id={each.id} wrapMode="none">
            {words("concurrent runs")}
            <span fg={mark(0)}>{String(state ? jobLimitOf(state) : 1)}</span>
          </text>
        );
      case "harness":
        return (
          <text key={each.id} id={each.id} wrapMode="none">
            {words("  harness")}
            <span fg={mark(0)}>{state?.harnesses?.[each.job] ?? (used ? `${used} (most used)` : "most used")}</span>
          </text>
        );
      case "model":
        return (
          <box key={each.id} id={each.id} flexDirection="row">
            <text wrapMode="none">{words("  model")}</text>
            <input
              focused={on}
              value={models[each.job] ?? state?.models?.[each.job] ?? ""}
              onInput={(typed) => setModels((previous) => ({ ...previous, [each.job]: typed }))}
              onSubmit={() => change((previous) => withModel(previous, each.job, models[each.job] ?? previous.models?.[each.job] ?? null))}
              placeholder="default"
            />
          </box>
        );
    }
  };

  /** What the cell under the cursor means, under the list. */
  const help = (): string => {
    if (row.kind === "steer") {
      // what the row is about, what its level does, and where an unset one comes from
      const about = row.at === "master" ? "every row not set" : KIND_LABEL[row.at];
      const level = column === 1 ? roomLevelOf(state ?? { steering: undefined }, room.id, row.at, row.cause) : everywhereOf(state, row.at, row.cause);
      if (level) return `${about}: ${STEERING_HELP[level]}`;
      const known = state ?? { steering: undefined };
      const roomId = column === 1 ? room.id : undefined;
      const applies = STEERING_HELP[row.at === "master" ? masterOf(known, row.cause, roomId) : levelOf(known, row.at, row.cause, roomId)];
      return `${about}: ${applies}${column === 1 ? " (as everywhere)" : row.at === "master" ? "" : " (as General)"}`;
    }
    if (row.kind === "tag") {
      const route = state ? tagRouteOf(state) : "existing";
      return route === "none" ? "a message for you waits in your inbox until you or your agent ask for it" : route === "existing" ? "a message for you wakes the conversation that worked on its ticket, as delivery allows" : `a message for you goes to ${TAG_LABEL[route]}`;
    }
    if (row.kind === "jobLimit") return "how many runs of your AI collagen keeps going at a time; the rest wait in line";
    if (row.kind === "merge") return MERGE_HELP[(column === 1 ? state?.merging?.rooms?.[room.id] : undefined) ?? state?.merging?.default ?? "off"];
    if (row.kind === "switch") {
      const setting = SETTINGS.find((candidate) => candidate.key === row.key)!;
      return state && settingOf(state, row.key) ? setting.on : setting.off;
    }
    if (row.kind === "harness") return `the AI collagen runs for ${JOB_LABEL[row.job]}: one you pick, or the one your conversations use most`;
    if (row.kind === "model") return "a model name the harness takes; an alias (haiku, sonnet) follows the newest · enter saves";
    return "";
  };

  return (
    <box flexDirection="column" gap={1} marginTop={1} flexGrow={1}>
      <box flexDirection="row">
        <text fg={onBar ? theme.accent : theme.dim} wrapMode="none">
          {onBar ? "› " : "  "}
        </text>
        {/* each tab takes a click as well as its keys */}
        {TABS.map((each, index) => (
          <text key={each.id} fg={each.id === tab ? theme.accent : theme.dim} wrapMode="none" onMouseDown={() => showTab(each.id)}>
            {`[${index + 1}] ${each.label}   `}
          </text>
        ))}
      </box>
      <FollowScroll follow={{ id: row.id }} flexGrow={1}>
        {rows.map(line)}
      </FollowScroll>
      <text fg={theme.dim}>{onBar ? "" : help()}</text>
      <text fg={theme.dim}>{onBar ? "←→ switch tab · 1-3 jump · ↓ into the settings · esc back" : "↑↓ row (↑ at the top: the tabs) · 1-3 tab · ←→ everywhere / this room · space changes it · esc back"}</text>
    </box>
  );
}
