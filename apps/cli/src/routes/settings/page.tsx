import { formatInvite } from "@collagen/p2p";
import { NET } from "../../app/net";
import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { writeProfileFile } from "../../config/profileFile";
import { useRouter } from "../../app/router";
import { useSession } from "../../app/session";
import { theme } from "../../app/theme";
import { SETTINGS, settingOf, withSetting, type SettingKey } from "../../lib/settings";
import { MERGE_HELP, MERGE_LEVELS, withMergeFor } from "../../lib/merging";
import { KIND_LABEL, STEERING_KINDS, STEERING_LABEL, STEERING_ORDER, TAG_LABEL, TAG_ROUTES, tagRouteOf, withLevel, withTagRoute, type Cause, type SteeringAt } from "../../lib/steering";
import type { MergeFor, Steering, SteeringLevels } from "@collagen/p2p";
import { myNameAtom, roomAtom } from "../atoms";
import { stateAtom, updateStateAtom } from "../room/atoms";
import { renameRoomAtom, setMyNameAtom } from "./atoms";

/** A steering level on the page: where it is set, and whose acts. */
type SteerField = `steer:${SteeringAt}:${Cause}`;
const STEER_AT: ReadonlyArray<SteeringAt> = ["master", ...STEERING_KINDS];
const STEER_FIELDS: ReadonlyArray<SteerField> = STEER_AT.flatMap((at) => [`steer:${at}:mine` as const, `steer:${at}:others` as const]);

type Field = "name" | "room" | SettingKey | "mergeDefault" | "mergeRoom" | SteerField | "tag";
const FIELDS: ReadonlyArray<Field> = ["name", "room", ...SETTINGS.map((setting) => setting.key), ...STEER_FIELDS, "tag", "mergeDefault", "mergeRoom"];

const isSteer = (field: Field): field is SteerField => field.startsWith("steer:");

/** A level round: not chosen (or following the master) first, then up from asking. */
const nextSteer = (level: Steering | undefined): Steering | null => {
  const order: ReadonlyArray<Steering | null> = [null, ...STEERING_ORDER];
  return order[(order.indexOf(level ?? null) + 1) % order.length]!;
};

const setLevel = (steering: SteeringLevels | undefined, at: SteeringAt, cause: Cause): Steering | undefined =>
  at === "master" ? steering?.master?.[cause] : steering?.kinds?.[at]?.[cause];

/** The level after `level` — or, for a room, after its own: none (the default's) first. */
const nextLevel = (level: MergeFor | undefined, allowNone: boolean): MergeFor | null => {
  const order: ReadonlyArray<MergeFor | null> = allowNone ? [null, ...MERGE_LEVELS] : MERGE_LEVELS;
  return order[(order.indexOf(level ?? (allowNone ? null : "off")) + 1) % order.length]!;
};

/** Settings frame: your name + the room's shared name, both applied on
 *  enter, then your switches, each applied the moment it is flipped (your
 *  agent can flip them for you too — set-settings). The room id is shown
 *  for reference only — it's the invite, never editable. */
export function SettingsPage() {
  const { profile } = useSession();
  const room = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" }));
  const { navigate } = useRouter();
  const myName = AsyncResult.getOrElse(useAtomValue(myNameAtom), () => "");
  const roomName = room.name;
  const setMyName = useAtomSet(setMyNameAtom);
  const renameRoom = useAtomSet(renameRoomAtom);

  const [name, setName] = useState(myName);
  const [label, setLabel] = useState(roomName);
  const [field, setField] = useState<Field>("name");
  const [saved, setSaved] = useState(false);
  const state = AsyncResult.getOrElse(useAtomValue(stateAtom), () => null);
  const updateState = useAtomSet(updateStateAtom);
  const flip = (key: SettingKey) => updateState({ update: (previous) => withSetting(previous, key, !settingOf(previous, key)) });
  // whose approval collagen waits for before it merges for you: the default each room is given, and this room's
  const cycleMerge = (which: "mergeDefault" | "mergeRoom") =>
    updateState({
      update: (previous) =>
        which === "mergeDefault"
          ? withMergeFor(previous, { default: true }, nextLevel(previous.merging?.default, false))
          : withMergeFor(previous, { room: room.id }, nextLevel(previous.merging?.rooms?.[room.id], true)),
    });
  // the person's steering: each level for their own acts and for others', and where a tag goes
  const cycleSteer = (field: SteerField) => {
    const [, at, cause] = field.split(":") as [string, SteeringAt, Cause];
    updateState({ update: (previous) => withLevel(previous, at, cause, nextSteer(setLevel(previous.steering, at, cause))) });
  };
  const cycleTag = () =>
    updateState({ update: (previous) => withTagRoute(previous, TAG_ROUTES[(TAG_ROUTES.indexOf(tagRouteOf(previous)) + 1) % TAG_ROUTES.length]!) });
  const mergeDefault: MergeFor = state?.merging?.default ?? "off";
  const mergeRoom = state?.merging?.rooms?.[room.id];

  const next = () => setField((current) => FIELDS[(FIELDS.indexOf(current) + 1) % FIELDS.length]!);
  const prev = () => setField((current) => FIELDS[(FIELDS.indexOf(current) + FIELDS.length - 1) % FIELDS.length]!);
  const submit = () => {
    const newName = name.trim();
    const newRoomName = label.trim();
    if (newName.length === 0 || newRoomName.length === 0) return;
    writeProfileFile(profile, { name: newName });
    if (newName !== myName) setMyName({ name: newName });
    // renaming is shared state — broadcast to the whole room
    if (newRoomName !== roomName) renameRoom({ name: newRoomName });
    setSaved(true);
  };

  useKeyboard((key) => {
    if (key.name === "tab") return key.shift ? prev() : next();
    if (key.name === "escape") return navigate("room/overview");
    // on a switch (not typing in a field): arrows move, space or enter flips
    if (field === "name" || field === "room") return;
    if (key.name === "down") return next();
    if (key.name === "up") return prev();
    if (key.name === "space" || key.name === "return" || key.name === "enter") {
      if (isSteer(field)) return cycleSteer(field);
      if (field === "tag") return cycleTag();
      return field === "mergeDefault" || field === "mergeRoom" ? cycleMerge(field) : flip(field);
    }
  });

  return (
    <box flexDirection="column" gap={1} marginTop={1}>
      <text fg={theme.fg}>settings — profile "{profile}"</text>
      <box flexDirection="column" border borderStyle="rounded" borderColor={field === "name" ? theme.accent : theme.dim} paddingX={1} title=" your name ">
        <input focused={field === "name"} value={name} onInput={setName} onSubmit={next} placeholder="how peers see you" />
      </box>
      <box
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={field === "room" ? theme.accent : theme.dim}
        paddingX={1}
        title=" room name (shared with everyone) "
      >
        <input focused={field === "room"} value={label} onInput={setLabel} onSubmit={submit} placeholder="renames the room for the whole room" />
      </box>
      <box flexDirection="column" border borderStyle="rounded" borderColor={SETTINGS.some((setting) => setting.key === field) ? theme.accent : theme.dim} paddingX={1} title=" switches ">
        {SETTINGS.map((setting) => {
          const on = state ? settingOf(state, setting.key) : setting.default;
          const here = field === setting.key;
          return (
            <box key={setting.key} flexDirection="column">
              <text fg={here ? theme.accent : theme.fg}>
                {here ? "› " : "  "}
                {on ? "[on] " : "[off]"} {setting.label}
              </text>
              <text fg={theme.dim}>{`        ${on ? setting.on : setting.off}`}</text>
            </box>
          );
        })}
      </box>
      <box flexDirection="column" border borderStyle="rounded" borderColor={isSteer(field) || field === "tag" ? theme.accent : theme.dim} paddingX={1} title=" steering — what collagen does in your name ">
        {STEER_FIELDS.map((steerField) => {
          const [, at, cause] = steerField.split(":") as [string, SteeringAt, Cause];
          const set = setLevel(state?.steering, at, cause);
          const shown = set ? STEERING_LABEL[set] : at === "master" ? STEERING_LABEL.unset : "master's";
          const here = field === steerField;
          return (
            <text key={steerField} fg={here ? theme.accent : set && set !== "ask" ? theme.warn : theme.fg}>
              {here ? "› " : "  "}
              {`[${shown}] ${at === "master" ? "master" : KIND_LABEL[at]} — ${cause === "mine" ? "yours" : "other people's"}`}
            </text>
          );
        })}
        <text fg={field === "tag" ? theme.accent : theme.fg}>
          {field === "tag" ? "› " : "  "}
          {`[${state ? tagRouteOf(state) : "existing"}] a message for you goes to ${TAG_LABEL[state ? tagRouteOf(state) : "existing"]}`}
        </text>
        <text fg={theme.dim}>{"        not chosen: nothing is done outside collagen in your name · others' never follows yours"}</text>
      </box>
      <box flexDirection="column" border borderStyle="rounded" borderColor={field === "mergeDefault" || field === "mergeRoom" ? theme.accent : theme.dim} paddingX={1} title=" merge for me ">
        <text fg={field === "mergeDefault" ? theme.accent : theme.fg}>
          {field === "mergeDefault" ? "› " : "  "}
          {`[${mergeDefault}] default for rooms entered from now on`}
        </text>
        <text fg={theme.dim}>{`        ${MERGE_HELP[mergeDefault]}`}</text>
        <text fg={field === "mergeRoom" ? theme.accent : theme.fg}>
          {field === "mergeRoom" ? "› " : "  "}
          {`[${mergeRoom ?? "default"}] this room`}
        </text>
        <text fg={theme.dim}>{`        ${MERGE_HELP[mergeRoom ?? mergeDefault]} — a review can say otherwise; the host's own rules come first`}</text>
      </box>
      <text fg={theme.dim} truncate wrapMode="none">
        invite id: <span fg={theme.fg}>{formatInvite(room.id, NET)}</span> (fixed — press c in the room to copy)
      </text>
      <text fg={theme.dim}>tab next field · enter next/confirm · on a switch: space flips it · on steering or merge: space changes it</text>
      <text fg={theme.warn}>{saved ? "saved — applies now" : "changes apply live · esc back"}</text>
    </box>
  );
}
