import type { LocalState, Settings } from "@collagen/p2p";

/** The person's switches: on or off, each with a default, set on the
 *  settings page or by their agent for them (set-settings). One list, so
 *  the page, the tool and the words for both never drift apart — a new
 *  switch is a field on the Settings schema and an entry here. */

export type SettingKey = keyof Settings;

export interface Setting {
  readonly key: SettingKey;
  readonly default: boolean;
  /** For the person: the settings page's row. */
  readonly label: string;
  /** What on and off mean, for the person and the agent alike. */
  readonly on: string;
  readonly off: string;
}

export const SETTINGS: ReadonlyArray<Setting> = [
  {
    key: "openReviewPage",
    default: true,
    label: "open the review page when a review starts",
    on: "when your agent starts reading a review, its page opens in your browser",
    off: "the review page opens only when you ask (o in the room, or tell your agent)",
  },
];

/** A switch's value: what was set, or its default. */
export const settingOf = (state: Pick<LocalState, "settings">, key: SettingKey): boolean =>
  state.settings?.[key] ?? SETTINGS.find((s) => s.key === key)!.default;

/** The state with one switch set. */
export const withSetting = <S extends Pick<LocalState, "settings">>(state: S, key: SettingKey, value: boolean): S => ({
  ...state,
  settings: { ...state.settings, [key]: value },
});

/** Every switch and where it stands, a line each — for the agent. */
export const describeSettings = (state: Pick<LocalState, "settings">): string =>
  SETTINGS.map((s) => {
    const v = settingOf(state, s.key);
    return `${s.key}: ${v ? "on" : "off"}${v === s.default ? " (default)" : ""} — ${v ? s.on : s.off}`;
  }).join("\n");
