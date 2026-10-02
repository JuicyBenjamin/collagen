# Reading a review

A pull request shows the files a to z. Related changes end up far apart, unrelated ones
side by side, and the intent behind them is gone — worse when an agent wrote the code.
A collagen review ticket already carries the key to put it back together: its **why**
names, for every decision, `where` it landed (`file:line`), and for every fork in the
road, `at` (`file:line`). So the review can be read **by intent**.

## Opening it

`o` opens a review ticket in your browser — on its row in the overview's ticket list (the
hint says so when a review is selected), on the **why** section of its page, or on the
full why page:

```
http://127.0.0.1:<your instance's port>/review/<ticket id>
```

It also opens by itself when your agent starts reading a review you were asked for — once,
and only while the [switch](./using-the-cli#switches) for it is on (it is by default; your
agent can switch it off for you). Your agent can open it on request as well
(`open-review`).

If that review's page is already open, `o` brings its tab to the front instead of opening
another — on macOS, in Chrome, Safari, Brave, Edge, Arc, Vivaldi or Chromium, which macOS
asks you once to allow. Anywhere else (or if you said no) it opens a new tab, and the old
one hands it your place — the section and how far down you were — and closes itself. A
browser that won't let the old tab close leaves you with two.

The page keeps itself current: your collagen tells it when the review's why is revised (the
author's agent amends it whenever the code moves), when the ticket moves, or when the
branch's commit in your clone changes, and it reloads its data in place — what is on screen
stays until the new data is in.

It is served by your own running collagen, beside the MCP server, on **loopback only** —
nothing about the code leaves your machine, and a request that names another host is
refused. The url also goes to the activity log, for a machine with no browser to open.

## What it shows

It is for a person reading code, so the code is the loudest thing on it. One section per
**decision**, in the order the author gave them:

- the decision's title, then the **hunks at its lines** — a hunk holding a `where` line, or
  the nearest one within a few lines (line numbers drift as code is edited), or every hunk
  of a file when the decision names a file alone. A hunk that also serves another decision
  says so above it — "also under …", a link there;
- beside the code, quieter, the **why**: how the person steered it (their words), what
  their agent reasoned, and the **forks in the road** that fall in those hunks — what was
  chosen over what, why, and whose call it was. It stays in view as you scroll the code.
  On a narrower window it folds under the title, a click away;
- when the why points at code the diff does not change, a quiet note says it may be older
  than the branch.

Last, **not explained**: every change no decision covers — a finding in itself, worth a
question to the author — with any forks outside every decision's lines.

The plumbing stays out of the way: no decision ids, no pointer lists (each hunk names its
file), and where the diff came from is one line at the foot of the page.

## Types and definitions

On TypeScript and JavaScript files the code answers to the pointer, on added and unchanged
lines:

- a word you can ask about is underlined under the pointer, and the cursor says it can be
  clicked;
- **rest on it** and its type appears beside it — what a function takes and returns, what
  a value is — with the first paragraph of its doc comment (an overloaded function shows
  its first signature and how many more);
- **click it** to peek where it is declared, opened right under the line: its file and
  line, its doc comment as text (the first paragraph, "More" for the rest), then the
  declaration itself, coloured — long ones fold after eighteen lines, and further overloads
  or definitions fold under one line. It works the same for the branch's own code and for
  a package's types, Effect's or Solid's, read from your `node_modules`. `×`, Esc, or a
  second click closes it.

The type checker is collagen's own, not the project's: a pinned TypeScript 7
(`7.0.2`), run as `tsc --lsp`, whatever version the project uses — or none. It is not
shipped with collagen. The first time a review has TypeScript or JavaScript in it, the page
offers it — "Type hints for this review? Installs TypeScript 7.0.2 (about 30 MB), once." —
and only your click installs it: that exact version, from npm's registry, its install
scripts not run, into collagen's own folder (`~/.config/collagen/tools/typescript-7.0.2`).
`×` puts the offer away in that browser. Nothing changes for anyone who never clicks.

The project gives the code: the branch's commit is unpacked from your clone into a folder
of its own (`git archive`; your repository and its working tree are never touched), with
the clone's `node_modules` linked in so imports resolve to what you have installed. A
branch that changes its dependencies is therefore checked against yours. The server starts
on the first hover (a moment), stays for the page, and stops after ten idle minutes.
Removed lines are the base's and are not asked about.

## Where the diff comes from

**Your own clone**, which is git, which is the source of truth: the project's folder on
your machine (the one you shared or located on the projects panel), `git fetch`, then
`git diff <base>...<branch>`, local refs first, then `origin/`. No host API, no copy of the
code anywhere new. When the ticket names no base, `main` is assumed.

When there is no clone to read — you have not located the project here, or the branch is
not in it — and the review's link is on GitHub, the page asks GitHub for the compare
through **your own `gh` login**, and says so at the top. Hosts sit behind one small
interface (`HostAdapter`), GitHub the only one so far; they are also where the page's
back-links come from (the pull request, its checks, the compare). With neither, the page
lists the decisions and forks with their pointers, and says why there is no diff.

## The page itself

A small [Solid 2](https://github.com/solidjs/solid) app in `apps/review-web`, with
[TanStack Highlight](https://github.com/TanStack/highlight) for the code: each side of a
hunk (the old lines, the new lines) is tokenized as one block, so a string or comment that
opens on one line colours the next, and the tokens are rendered as the page's own spans —
nothing is ever set as HTML. About 28 KB gzipped. The cli build builds it and ships it in
`dist/review-web`; running collagen from source serves `apps/review-web/dist`
(`pnpm --filter @collagen/review-web build`, or `dev` to rebuild on change). The JSON it
reads, `/review/<ticket id>/data`, is typed once in `apps/review-web/src/data.ts`, which
the cli imports.

## Saying what you think

The page reads; it does not write. Your review goes back the way everything in collagen
does — through your agent, in your words, with `post-review` — so there is one path into
the room's log, and it is yours. Marks per decision straight from the page would be a
second path; that is a plan of its own once this one has proven the grouping.
