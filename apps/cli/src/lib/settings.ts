import type { Assistant, LocalState, Settings } from "@collagen/p2p";

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
    label: "open review pages",
    on: "when your agent starts reading a review, its page opens in your browser",
    off: "the review page opens only when you ask (o in the room, or tell your agent)",
  },
  {
    key: "investigationsAtOnce",
    default: false,
    label: "goals at once",
    on: "an investigation that sets no pace queues all its runs together, as many running as your job limit allows",
    off: "an investigation that sets no pace runs its goals one by one, each run reading what the last found",
  },
  {
    key: "progressBar",
    default: true,
    label: "progress bar",
    on: "a thin bar atop the review page fills as you scroll through it",
    off: "the review page shows no progress bar",
  },
];

/** The assistants, by the names they went by. A gag on no settings screen:
 *  a person finds it by asking their agent (set-settings assistant). */
export const ASSISTANT_NAME: Record<Assistant, string> = {
  clippy: "Clippy",
  bonzi: "Bonzi",
  f1: "F1",
  genie: "Genie",
  genius: "Genius",
  links: "Links",
  merlin: "Merlin",
  peedy: "Peedy",
  rocky: "Rocky",
  rover: "Rover",
};

/** The state with the assistant chosen, or none (null): the plain chat again. */
export const withAssistant = <S extends Pick<LocalState, "assistant">>(state: S, assistant: Assistant | null): S => {
  const { assistant: _gone, ...rest } = state;
  return (assistant === null ? rest : { ...rest, assistant }) as S;
};

/** A switch's value: what was set, or its default. */
export const settingOf = (state: Pick<LocalState, "settings">, key: SettingKey): boolean =>
  state.settings?.[key] ?? SETTINGS.find((setting) => setting.key === key)!.default;

/** The state with one switch set. */
export const withSetting = <S extends Pick<LocalState, "settings">>(state: S, key: SettingKey, value: boolean): S => ({
  ...state,
  settings: { ...state.settings, [key]: value },
});

/** Every switch and where it stands, a line each — for the agent. */
export const describeSettings = (state: Pick<LocalState, "settings" | "assistant">): string =>
  SETTINGS.map((setting) => {
    const value = settingOf(state, setting.key);
    return `${setting.key}: ${value ? "on" : "off"}${value === setting.default ? " (default)" : ""} — ${value ? setting.on : setting.off}`;
  }).join("\n") + (state.assistant ? `\nassistant: ${ASSISTANT_NAME[state.assistant]} — the review page's ask-AI chat is ${ASSISTANT_NAME[state.assistant]}` : "");
