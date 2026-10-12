import { createEffect, createMemo, createSignal, For } from "solid-js";
import { saveThemes } from "../api";
import { lasting } from "../lasting";
import { overSocket } from "../liveSocket";
import { applyTheme, cacheThemes, cachedThemes, currentAsCustom, EDITABLE, heldBeforeCollagen, NEW, themeFromText, toHex } from "../theme";
import { NAME_MAX, nameOf, savedValue, THEMES, type PageThemes, type Saved } from "../themeData";
import { Appear } from "./Appear";

/** A name as the select shows it: as much as fits beside its arrow at its one width. */
const SHOWN_MAX = 14;
const shown = (name: string): string => (name.length > SHOWN_MAX ? `${name.slice(0, SHOWN_MAX - 1).trimEnd()}…` : name);

/** The page's theme: one of daisyUI's, collagen's own, or one of the
 *  person's — as many as they make, each named, edited here a colour at a
 *  time or pasted whole (CSS, or a daisyUI theme generator link). Collagen
 *  keeps them, so the person's agent can choose and add them too
 *  (set-theme), and every open page follows; this browser keeps a copy to
 *  open in. Edit sits left of the select: it comes and goes without moving
 *  the select or anything right of it. */
export function ThemePicker() {
  const [themes, setThemes] = createSignal<PageThemes>(cachedThemes());
  const [editing, setEditing] = createSignal(false);
  const [pasted, setPasted] = createSignal("");
  const [unread, setUnread] = createSignal(false);
  const saved = () => themes().saved;
  const chosen = () => themes().chosen;
  /** the person's own theme on show, when one is */
  const own = () => saved().find((theme) => savedValue(theme.id) === chosen()) ?? null;

  const show = (next: PageThemes) => {
    setThemes(next);
    applyTheme(next);
    cacheThemes(next);
  };
  /** shown now, and kept by collagen, which tells every page */
  const commit = (next: PageThemes) => {
    show(next);
    void saveThemes(next).catch(() => undefined);
  };
  // collagen's copy, live: a change made elsewhere — another page, the person's agent — shows here at once
  const live = createMemo(() => lasting(() => overSocket("themes", "")));
  createEffect(live, (kept) => {
    // collagen keeps none yet: this browser's (an older page's too) become collagen's
    if (kept === null) {
      if (heldBeforeCollagen() || saved().length > 0 || chosen() !== "") void saveThemes(themes()).catch(() => undefined);
      return;
    }
    if (kept) show(kept);
  });

  /** the one on show, changed */
  const change = (update: (theme: Saved) => Saved) => {
    const now = own();
    if (now) commit({ ...themes(), saved: saved().map((theme) => (theme.id === now.id ? update(theme) : theme)) });
  };
  const choose = (value: string) => {
    if (value !== NEW) {
      // another theme on show: the editor of the last one closes
      setEditing(false);
      return commit({ ...themes(), chosen: value });
    }
    // a new one starts as the theme on show
    const id = crypto.randomUUID().slice(0, 8);
    commit({ chosen: savedValue(id), saved: [...saved(), { ...currentAsCustom(), id, name: `Theme ${saved().length + 1}` }] });
    setEditing(true);
  };
  const remove = () => {
    const now = own();
    if (!now) return;
    setEditing(false);
    commit({ chosen: "", saved: saved().filter((theme) => theme.id !== now.id) });
  };
  const paste = async () => {
    const parsed = await themeFromText(pasted());
    setUnread(parsed === null);
    if (!parsed) return;
    change((theme) => ({ ...theme, scheme: parsed.scheme, vars: { ...theme.vars, ...parsed.vars } }));
    setPasted("");
  };

  return (
    <div class="theme-pick">
      <span class="theme-select">
        {/* hung left of the select, out of the line: it comes and goes, Edit or Done, and nothing moves */}
        <Appear when={own()}>
          {() => (
            <button type="button" class="btn btn-xs" aria-expanded={editing() ? "true" : "false"} onClick={() => setEditing(!editing())}>
              {editing() ? "Done" : "Edit"}
            </button>
          )}
        </Appear>
        <select class="select select-xs" aria-label="Theme" title={own()?.name ?? "The page's theme"} value={chosen()} onChange={(event) => choose(event.currentTarget.value)}>
        <For each={THEMES}>
          {(theme) => (
            <option value={theme.name} selected={chosen() === theme.name}>
              {theme.label}
            </option>
          )}
        </For>
        <optgroup label="Yours">
          <For each={saved()}>
            {(theme) => (
              <option value={savedValue(theme.id)} selected={chosen() === savedValue(theme.id)} title={theme.name}>
                {shown(theme.name)}
              </option>
            )}
          </For>
          <option value={NEW}>New theme…</option>
        </optgroup>
        </select>
      </span>
      <Appear when={editing() && own()}>
        {(theme) => (
          <div class="theme-editor">
            <label class="theme-name">
              Name
              <input
                class="input input-xs"
                maxlength={NAME_MAX}
                value={theme().name}
                onChange={(event) => change((current) => ({ ...current, name: nameOf(event.currentTarget.value, current.name) }))}
              />
            </label>
            <div class="theme-colours">
              <For each={EDITABLE}>
                {([name, label]) => (
                  <label>
                    <input type="color" value={toHex(theme().vars[name] ?? "#000")} onInput={(event) => change((current) => ({ ...current, vars: { ...current.vars, [name]: event.currentTarget.value } }))} />
                    {label}
                  </label>
                )}
              </For>
              <label>
                <select class="select select-xs" onChange={(event) => change((current) => ({ ...current, scheme: event.currentTarget.value === "dark" ? "dark" : "light" }))}>
                  <option value="light" selected={theme().scheme === "light"}>
                    Light
                  </option>
                  <option value="dark" selected={theme().scheme === "dark"}>
                    Dark
                  </option>
                </select>
              </label>
            </div>
            <textarea class="textarea" rows={3} placeholder="Paste a theme generator link, or a theme's CSS" value={pasted()} onInput={(event) => (setPasted(event.currentTarget.value), setUnread(false))} />
            <div class="theme-editor-foot">
              <a href="https://daisyui.com/theme-generator/" target="_blank" rel="noreferrer">
                Powered by daisyUI
              </a>
              <Appear when={unread()}>{() => <span class="theme-unread">No theme variables in it</span>}</Appear>
              <button type="button" class="btn btn-xs theme-delete" onClick={remove}>
                Delete
              </button>
              <button type="button" class="btn btn-xs" disabled={pasted().trim() === ""} onClick={() => void paste()}>
                Use pasted
              </button>
            </div>
          </div>
        )}
      </Appear>
    </div>
  );
}
