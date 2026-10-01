# Reading a review

A pull request shows the files a to z. Related changes end up far apart, unrelated ones
side by side, and the intent behind them is gone — worse when an agent wrote the code.
A collagen review ticket already carries the key to put it back together: its **why**
names, for every decision, `where` it landed (`file:line`), and for every fork in the
road, `at` (`file:line`). So the review can be read **by intent**.

## Opening it

On a review ticket's page in the TUI, `o` (on the **why** section, or on the full why
page) opens the review in your browser:

```
http://127.0.0.1:<your instance's port>/review/<ticket id>
```

It is served by your own running collagen, beside the MCP server, on **loopback only** —
nothing about the code leaves your machine, and a request that names another host is
refused. The url also goes to the activity log, for a machine with no browser to open.

## What it shows

One section per **decision**, in the order the author gave them:

- what was decided, **how the person steered it** (their words) and **what their agent
  reasoned**;
- the **hunks at its lines** — a hunk holding a `where` line, or the nearest one within a
  few lines (line numbers drift as code is edited), or every hunk of a file when the
  decision names a file alone. A hunk two decisions both claim shows under both, marked
  **shared**;
- the **forks** whose `at` falls inside those hunks: what was chosen, instead of what,
  why, and whose call it was;
- a `where` that matches no change is said, not dropped: the code there did not move, or
  the why is older than the branch.

Last, **not explained**: every hunk no decision claims. That is a finding in itself — the
why does not cover it — and forks outside every decision's lines are listed there too.

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

## Saying what you think

The page reads; it does not write. Your review goes back the way everything in collagen
does — through your agent, in your words, with `post-review` — so there is one path into
the room's log, and it is yours. Marks per decision straight from the page would be a
second path; that is a plan of its own once this one has proven the grouping.
