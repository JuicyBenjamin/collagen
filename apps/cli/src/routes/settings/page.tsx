import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { JobKind, LocalState, MergeFor, Steering } from "@collagen/p2p";
import { useRouter } from "../../app/router";
import { theme } from "../../app/theme";
import { FollowScroll } from "../../components/FollowScroll";
import { SETTINGS, settingOf, withSetting } from "../../lib/settings";
import { MERGE_HELP, MERGE_LEVELS, withMergeFor } from "../../lib/merging";
import { roomLevelOf, STEERING_HELP, STEERING_LABEL, STEERING_ORDER, TAG_LABEL, TAG_ROUTES, tagRouteOf, withLevel, withTagRoute, type Cause, type SteeringAt } from "../../lib/steering";
import { JOB_LABEL, jobLimitOf, mostUsedHarness, withHarness, withModel } from "../../lib/jobs";
import { roomAtom } from "../atoms";
import { aiChoicesAtom, stateAtom, updateStateAtom } from "../room/atoms";
import { pickable, ROWS, STEER_WORDS, TABS, twoColumns, type Row, type Tab } from "./rows";

/** The width of a row's words, and of each column after them. */
const WORDS = 48;
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

/** Settings: what collagen and your AI may do in your name, everywhere and
 *  in the room you are in, in three tabs — AI, the repo host, and the
 *  general level the rest follow. Each change applies the moment it is made
 *  (your agent can make them too: set-steering, set-jobs, set-settings, set-merging). */
export function SettingsPage() {
  const room = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" }));
  const { navigate } = useRouter();
  const state = AsyncResult.getOrElse(useAtomValue(stateAtom), () => null);
  const choices = AsyncResult.getOrElse(useAtomValue(aiChoicesAtom), (): ReadonlyArray<string | null> => [null]);
  const updateState = useAtomSet(updateStateAtom);
  const [tab, setTab] = useState<Tab>("ai");
  const rows = ROWS[tab];
  const [cursor, setCursor] = useState(1);
  const [column, setColumn] = useState<0 | 1>(0);
  const [models, setModels] = useState<Partial<Record<JobKind, string>>>({});
  const row = rows[Math.min(cursor, rows.length - 1)]!;
  const used = state ? mostUsedHarness(state) : null;

  const move = (by: 1 | -1) => {
    let next = cursor;
    do next = (next + by + rows.length) % rows.length;
    while (!pickable(rows[next]!));
    setCursor(next);
  };
  const switchTab = (by: 1 | -1) => {
    const next = TABS[(TABS.findIndex((each) => each.id === tab) + by + TABS.length) % TABS.length]!.id;
    setTab(next);
    setCursor(ROWS[next].findIndex(pickable));
    setColumn(0);
  };

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
    if (row.kind === "tag") return change((previous) => withTagRoute(previous, TAG_ROUTES[(TAG_ROUTES.indexOf(tagRouteOf(previous)) + 1) % TAG_ROUTES.length]!));
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
    if (key.name === "down") return move(1);
    if (key.name === "up") return move(-1);
    // typing a model: the arrows and space are the field's
    if (row.kind === "model") return;
    if (key.name === "left") return setColumn(0);
    if (key.name === "right") return setColumn(twoColumns(row) ? 1 : 0);
    if (key.name === "space" || key.name === "return" || key.name === "enter") return act();
  });

  /** One cell's words: what is set, or what it follows. */
  const steerCell = (at: SteeringAt, cause: Cause, here: boolean): string => {
    if (here) {
      const own = roomLevelOf(state ?? { steering: undefined }, room.id, at, cause);
      return own ? STEERING_LABEL[own] : "· follows";
    }
    const set = everywhereOf(state, at, cause);
    return set ? STEERING_LABEL[set] : at === "master" ? STEERING_LABEL.unset : "· general";
  };

  const line = (each: Row, index: number) => {
    const on = index === cursor;
    const mark = (col: 0 | 1) => (on && column === col ? theme.accent : theme.fg);
    const words = (text: string) => <span fg={on ? theme.accent : theme.fg}>{`${on ? "› " : "  "}${text}`.padEnd(WORDS).slice(0, WORDS)}</span>;
    switch (each.kind) {
      case "heading":
        return (
          <text key={each.id} id={each.id} fg={theme.dim}>
            {each.text}
          </text>
        );
      case "steer":
        return (
          <text key={each.id} id={each.id} wrapMode="none">
            {words(`${STEER_WORDS[each.at]} — ${each.cause === "mine" ? "yours" : "others'"}`)}
            <span fg={mark(0)}>{cell(steerCell(each.at, each.cause, false))}</span>
            <span fg={mark(1)}>{cell(steerCell(each.at, each.cause, true))}</span>
          </text>
        );
      case "merge": {
        const mergeRoom = state?.merging?.rooms?.[room.id];
        return (
          <text key={each.id} id={each.id} wrapMode="none">
            {words("merge for me")}
            <span fg={mark(0)}>{cell(state?.merging?.default ?? "off")}</span>
            <span fg={mark(1)}>{cell(mergeRoom ?? "· follows")}</span>
          </text>
        );
      }
      case "tag":
        return (
          <text key={each.id} id={each.id} wrapMode="none">
            {words("a message for you goes to")}
            <span fg={mark(0)}>{TAG_LABEL[state ? tagRouteOf(state) : "existing"]}</span>
          </text>
        );
      case "switch": {
        const setting = SETTINGS.find((candidate) => candidate.key === each.key)!;
        return (
          <text key={each.id} id={each.id} wrapMode="none">
            {words(setting.label)}
            <span fg={mark(0)}>{state && settingOf(state, each.key) ? "on" : "off"}</span>
          </text>
        );
      }
      case "jobLimit":
        return (
          <text key={each.id} id={each.id} wrapMode="none">
            {words("jobs at a time")}
            <span fg={mark(0)}>{String(state ? jobLimitOf(state) : 1)}</span>
            <span fg={theme.dim}>{"  the rest wait in line"}</span>
          </text>
        );
      case "harness":
        return (
          <text key={each.id} id={each.id} wrapMode="none">
            {words(`${JOB_LABEL[each.job]}: with`)}
            <span fg={mark(0)}>{state?.harnesses?.[each.job] ?? `the one you use most${used ? ` (${used})` : ""}`}</span>
          </text>
        );
      case "model":
        return (
          <box key={each.id} id={each.id} flexDirection="row">
            <text wrapMode="none">{words("  its model")}</text>
            <input
              focused={on}
              value={models[each.job] ?? state?.models?.[each.job] ?? ""}
              onInput={(typed) => setModels((previous) => ({ ...previous, [each.job]: typed }))}
              onSubmit={() => change((previous) => withModel(previous, each.job, models[each.job] ?? previous.models?.[each.job] ?? null))}
              placeholder="the harness's default"
            />
          </box>
        );
    }
  };

  /** What the cell under the cursor means, under the list. */
  const help = (): string => {
    if (row.kind === "steer") {
      const level = column === 1 ? roomLevelOf(state ?? { steering: undefined }, room.id, row.at, row.cause) : everywhereOf(state, row.at, row.cause);
      if (level) return STEERING_HELP[level];
      return column === 1 ? "this room follows everywhere" : row.at === "master" ? STEERING_HELP.unset : "follows the general level (General tab)";
    }
    if (row.kind === "merge") return MERGE_HELP[(column === 1 ? state?.merging?.rooms?.[room.id] : undefined) ?? state?.merging?.default ?? "off"];
    if (row.kind === "switch") {
      const setting = SETTINGS.find((candidate) => candidate.key === row.key)!;
      return state && settingOf(state, row.key) ? setting.on : setting.off;
    }
    if (row.kind === "harness") return "a harness collagen knows, or the one your conversations work in most";
    if (row.kind === "model") return "a model name the harness takes; an alias (haiku, sonnet) follows the newest · enter saves";
    return "";
  };

  return (
    <box flexDirection="column" gap={1} marginTop={1} flexGrow={1}>
      <text wrapMode="none">
        {TABS.map((each) => (
          <span key={each.id} fg={each.id === tab ? theme.accent : theme.dim}>{each.id === tab ? `[${each.label}]  ` : ` ${each.label}   `}</span>
        ))}
        <span fg={theme.dim}>{`   this room: ${room.name}`}</span>
      </text>
      {rows.some(twoColumns) ? (
        <text fg={theme.dim} wrapMode="none">
          {"".padEnd(WORDS)}
          {cell("everywhere")}
          {cell("this room")}
        </text>
      ) : null}
      <FollowScroll follow={{ id: row.id }} flexGrow={1}>
        {rows.map(line)}
      </FollowScroll>
      <text fg={theme.dim}>{help()}</text>
      <text fg={theme.dim}>tab next tab · ↑↓ row · ←→ everywhere / this room · space changes it · esc back</text>
    </box>
  );
}
