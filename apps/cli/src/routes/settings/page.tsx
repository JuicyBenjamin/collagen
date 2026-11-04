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
import { CAUSE_WORDS, pickable, TAG_CHOICES, ROWS, STEER_WORDS, TABS, TAG_WORDS, type Row, type Scope, type Tab } from "./rows";

/** The width of a row's words, and of each column after them. */
const WORDS = 33;
/** A steering row's name, before whose doing it is. */
const KIND = 16;
const COLUMN = 24;
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
/** Every label, value and line on the page starts with a capital, whatever
 *  shared words it is built from — one rule, so none reads as a slip. */
const capital = (text: string): string => text.replace(/[A-Za-z]/, (letter) => letter.toUpperCase());
const cell = (text: string) => capital(text).padEnd(COLUMN).slice(0, COLUMN);

/** Settings: what collagen may do in your name, by who acts — your AI, or
 *  tools collagen calls itself with no AI — and the general level the rest
 *  follow. Two pages, one place per scope: S in a room opens that room's
 *  steering alone, a value it does not set shown as the global one it takes;
 *  g there opens the global settings, everything else with them. Each change
 *  applies the moment it is made (your agent can make them too:
 *  set-steering, set-jobs, set-settings, set-merging). */
export function SettingsPage({ scope }: { scope: Scope }) {
  const room = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" }));
  const { navigate } = useRouter();
  const state = AsyncResult.getOrElse(useAtomValue(stateAtom), () => null);
  const choices = AsyncResult.getOrElse(useAtomValue(aiChoicesAtom), (): ReadonlyArray<string | null> => [null]);
  const updateState = useAtomSet(updateStateAtom);
  const [tab, setTab] = useState<Tab>(TABS[0]!.id);
  const rows = ROWS[scope][tab];
  const [cursor, setCursor] = useState(() => ROWS[scope][TABS[0]!.id].findIndex(pickable));
  const here = scope === "room";
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
    setCursor(ROWS[scope][next].findIndex(pickable));
  };
  const switchTab = (by: 1 | -1) => showTab(TABS[(TABS.findIndex((each) => each.id === tab) + by + TABS.length) % TABS.length]!.id);

  const change = (update: (previous: LocalState) => LocalState) => updateState({ update });
  /** space or enter on the cell under the cursor */
  const act = () => {
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
    // the global page is reached from the room's, and goes back to it
    if (key.name === "escape") return navigate(here ? "room/overview" : "settings");
    if (key.name === "g" && here && row.kind !== "model") return navigate("settings/global");
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
    if (key.name === "space" || key.name === "return" || key.name === "enter") return act();
  });

  /** A steering row's cell: the level that applies on this page, and
   *  whether it is set here (bright) or taken from above it (dim). In a
   *  room, one it does not set is its Default — the global setting, shown
   *  beside it, so choosing it there changes nothing global; globally, a
   *  row not set follows the General tab. */
  const steerCell = (at: SteeringAt, cause: Cause): { readonly text: string; readonly set: boolean } => {
    const known = state ?? { steering: undefined };
    const roomId = here ? room.id : undefined;
    const applies = at === "master" ? masterOf(known, cause, roomId) : levelOf(known, at, cause, roomId);
    const set = here ? roomLevelOf(known, room.id, at, cause) !== undefined : everywhereOf(state, at, cause) !== undefined;
    return { text: here && !set ? `Default (${STEERING_LABEL[applies]})` : STEERING_LABEL[applies], set };
  };

  const line = (each: Row, index: number) => {
    const on = !onBar && index === cursor;
    const mark = (set = true) => (on ? theme.accent : set ? theme.fg : theme.dim);
    const words = (text: string) => <span fg={on ? theme.accent : theme.fg}>{`${on ? "› " : "  "}${capital(text)}`.padEnd(WORDS).slice(0, WORDS)}</span>;
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
            {`  ${capital(each.text)}`}
          </text>
        );
      case "space":
        return <text key={each.id} id={each.id}>{" "}</text>;
      case "note":
        return (
          <text key={each.id} id={each.id} fg={theme.dim}>
            {`${" ".repeat(each.indent ?? 0)}${each.text}`}
          </text>
        );
      case "steer": {
        const value = steerCell(each.at, each.cause);
        return (
          <text key={each.id} id={each.id} wrapMode="none">
            {/* the General rows say whose doing; the rest sit under Single player or Multiplayer, and under their ticket kind */}
            {words(each.at === "master" ? `${(each.unnamed ? "" : capital(STEER_WORDS.master)).padEnd(KIND)}${CAUSE_WORDS[each.cause]}` : `  ${capital(STEER_WORDS[each.at])}`)}
            <span fg={mark(value.set)}>{cell(value.text)}</span>
          </text>
        );
      }
      case "merge": {
        const mergeRoom = here ? state?.merging?.rooms?.[room.id] : undefined;
        const everywhere = state?.merging?.default ?? "off";
        return (
          <text key={each.id} id={each.id} wrapMode="none">
            {words("  auto-merge")}
            <span fg={mark(!here || mergeRoom !== undefined)}>{cell(mergeRoom ?? (here ? `Default (${everywhere})` : everywhere))}</span>
          </text>
        );
      }
      case "tag":
        return (
          <text key={each.id} id={each.id} wrapMode="none">
            {words("  go to")}
            <span fg={mark()}>{capital(TAG_WORDS[state ? tagRouteOf(state) : "existing"])}</span>
          </text>
        );
      case "switch": {
        const setting = SETTINGS.find((candidate) => candidate.key === each.key)!;
        return (
          <text key={each.id} id={each.id} wrapMode="none">
            {words(each.name ?? setting.label)}
            <span fg={mark()}>{capital(state && settingOf(state, each.key) ? (each.says?.on ?? "on") : (each.says?.off ?? "off"))}</span>
          </text>
        );
      }
      case "jobLimit":
        return (
          <text key={each.id} id={each.id} wrapMode="none">
            {words("concurrent runs")}
            <span fg={mark()}>{String(state ? jobLimitOf(state) : 1)}</span>
          </text>
        );
      case "harness":
        return (
          <text key={each.id} id={each.id} wrapMode="none">
            {words("  harness")}
            <span fg={mark()}>{capital(state?.harnesses?.[each.job] ?? (used ? `${used} (most used)` : "most used"))}</span>
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
              placeholder="Default"
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
      const level = here ? roomLevelOf(state ?? { steering: undefined }, room.id, row.at, row.cause) : everywhereOf(state, row.at, row.cause);
      if (level) return `${about}: ${STEERING_HELP[level]}`;
      const known = state ?? { steering: undefined };
      const roomId = here ? room.id : undefined;
      const applies = STEERING_HELP[row.at === "master" ? masterOf(known, row.cause, roomId) : levelOf(known, row.at, row.cause, roomId)];
      return `${about}: ${applies}${here ? " (this room's default: your global setting)" : row.at === "master" ? "" : " (as General)"}`;
    }
    if (row.kind === "tag") {
      const route = state ? tagRouteOf(state) : "existing";
      return route === "none" ? "a message for you waits in your inbox until you or your agent ask for it" : route === "existing" ? "a message for you wakes the conversation that worked on its ticket, as delivery allows" : `a message for you goes to ${TAG_LABEL[route]}`;
    }
    if (row.kind === "jobLimit") return "how many runs of your AI collagen keeps going at a time; the rest wait in line";
    if (row.kind === "merge") return MERGE_HELP[(here ? state?.merging?.rooms?.[room.id] : undefined) ?? state?.merging?.default ?? "off"];
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
        {/* which page this is: one room's steering, or what every room takes */}
        <text fg={theme.fg} wrapMode="none" truncate>
          {here ? `·  Steering in ${room.name ? clip(room.name, 40) : "this room"}` : "·  Global settings"}
        </text>
      </box>
      <FollowScroll follow={{ id: row.id }} flexGrow={1}>
        {rows.map(line)}
      </FollowScroll>
      <text fg={theme.dim}>{onBar ? "" : capital(help())}</text>
      <text fg={theme.dim}>
        {onBar ? "←→ switch tab · 1-3 jump · ↓ into the settings" : "↑↓ row (↑ at the top: the tabs) · 1-3 tab · space changes it"}
        {here ? " · g global settings · esc back" : " · esc the room's steering"}
      </text>
    </box>
  );
}
