import { createSignal, For, Show } from "solid-js";
import type { BoardData } from "~/data";

/** Which epic the board is read through: a combo box — type to find one
 *  among many, the arrows and Enter to pick, × for all tickets again. A
 *  daisyUI dropdown with a menu of the epics, the most open first. */
export function EpicPicker(props: { epics: BoardData["epics"]; chosen: string | null; onChoose: (epic: string | null) => void }) {
  const [query, setQuery] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [pointed, setPointed] = createSignal(0);
  const title = () => props.epics.find((epic) => epic.id === props.chosen)?.title ?? "";
  const matches = () => {
    const typed = query().trim().toLowerCase();
    return props.epics.filter((epic) => epic.title.toLowerCase().includes(typed));
  };
  const choose = (epic: string | null) => {
    props.onChoose(epic);
    setOpen(false);
    setQuery("");
  };
  const show = () => {
    setQuery("");
    setPointed(0);
    setOpen(true);
  };
  const move = (by: number) => {
    setOpen(true);
    setPointed(Math.max(0, Math.min(matches().length - 1, pointed() + by)));
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      const hit = matches()[pointed()];
      if (open() && hit) {
        event.preventDefault();
        choose(hit.id);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };
  return (
    <div class={["dropdown board-epic", open() ? "dropdown-open" : "dropdown-close"]}>
      <label class="input input-sm">
        <span class="label">Epic</span>
        <input
          type="text"
          role="combobox"
          aria-expanded={open() ? "true" : "false"}
          aria-controls="board-epics"
          aria-autocomplete="list"
          autocomplete="off"
          placeholder="All tickets"
          value={open() ? query() : title()}
          // focus opens it, and so does a click while it is still focused after a pick
          onFocus={show}
          onClick={() => open() || show()}
          onBlur={() => setOpen(false)}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            setPointed(0);
            setOpen(true);
          }}
          onKeyDown={key}
        />
        <Show when={props.chosen !== null && !open()}>
          <button type="button" class="btn btn-ghost btn-xs btn-circle" aria-label="All tickets" title="All tickets" onClick={() => choose(null)}>
            ×
          </button>
        </Show>
      </label>
      <ul id="board-epics" role="listbox" class="dropdown-content menu board-epic-list">
        <For each={matches()} fallback={<li class="menu-disabled"><span>No epic with open tickets by that name</span></li>}>
          {(epic, index) => (
            <li role="option" aria-selected={epic.id === props.chosen ? "true" : "false"}>
              {/* the input keeps focus through a click, so the list stays until the pick; a plain row, the menu's own item, as the page has no reset for a button */}
              <div
                class={{ "menu-focus": index() === pointed(), "menu-active": epic.id === props.chosen }}
                onPointerDown={(event) => event.preventDefault()}
                onPointerEnter={() => setPointed(index())}
                onClick={() => choose(epic.id)}
              >
                <span class="board-epic-title">{epic.title}</span>
                <span class="badge badge-ghost badge-sm">{epic.open} open</span>
              </div>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
