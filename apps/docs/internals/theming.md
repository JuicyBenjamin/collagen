# Page themes

Every page collagen serves (`apps/review-web`: a review, a room's merges) is styled with [daisyUI](https://daisyui.com) 5,
used as plain CSS — no Tailwind build. `src/themes.css` imports daisyUI's variables
for a handful of its themes and the few components the pages use (button, textarea,
checkbox, radio, select, input). The pages' own CSS (`src/styles.css`) reads its palette —
`--bg`, `--panel`, `--fg`, `--dim`, `--line`, `--accent`, `--warn`, the diff colours —
from daisyUI's variables, so every rule follows whichever theme is on show.

## How a theme is stored and swapped

A theme is one block of CSS variables under `[data-theme="<name>"]`. Every bundled
theme ships in the page's one stylesheet (a few hundred bytes each), and choosing one
sets `data-theme` on `<html>`: the variables swap in place, nothing is fetched, nothing
flashes. A CSS file per theme was the other option; it buys nothing at this size and
adds a load on every switch.

- **No theme chosen** is collagen's own: the TUI's palette, Tokyo Night when the
  system is dark. It sets a few `--collagen-*` shades exactly; other themes have
  those mixed from their variables.
- **daisyUI's themes** sit in a CSS layer, so collagen's own and a custom theme win
  over them whatever their selectors weigh.
- **The reader's own themes**, as many as they make, each named: a new one starts as
  the theme on show, takes a colour at a time or a theme pasted from daisyUI's
  [theme generator](https://daisyui.com/theme-generator/), and the one on show is
  written into a `<style>` under `[data-theme="custom"]`. Only daisyUI's variables
  are kept from a paste, and nothing that could end the rule; a kept theme is checked
  the same way each time it is read back.
- **`data-scheme`** (light or dark) goes with the theme, for the code's colours:
  TanStack Highlight's GitHub Light or One Dark Pro.

Collagen keeps the choice and the person's themes in their profile's state
(`themes`, local, never broadcast), so their agent can choose and add them too
(`themes`, `set-theme`, `add-theme`, `edit-theme`, `remove-theme`; a daisyUI theme generator link is taken as it is pasted), and
every open page follows at once over its live connection. The browser keeps a
copy (`collagen.theme.v2`) so a page opens in its theme before collagen answers.
Themes an older page kept in the browser alone are handed to collagen the first time
a page opens; its one custom theme becomes "My theme".

## One theme, one switch, every page

`src/themeNow.ts` holds the theme on show for whichever page is open: `main.tsx`
starts it before any page renders, so every page wears the theme and follows
collagen's copy live, switch on screen or not. The switch is the page's corner
(`components/Corner`): the theme picker, then whatever the page keeps beside it.
A new page puts `<Corner />` in its header and reads its colours from
`styles.css`'s variables; nothing else.

## The editor

It is collagen's own, a few colour inputs and a paste box; nothing of daisyUI's
generator is copied. The generator stays theirs, linked as "Powered by daisyUI";
what it exports pastes straight in.
