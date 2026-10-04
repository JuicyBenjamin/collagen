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

It is for a person reading code, so the code is the loudest thing on it — after the
purpose. A review's title heads the page — a few words, what the change is for — with its
summary beneath it and where the code is above it, small, so you know what the change is
for before reading any of it (a review filed before titles leads with its summary). Then the change in **units**: code
that together achieves one thing — a component with its sub-components, its implementation
and its tests; a service and its routes — each titled by what it achieves ("Big exports
finish"), never by a file. **Every change is shown once**, in exactly one unit; a unit can
hold part of a file (one route of a big routes file) and another unit the rest.

- **Who decides.** The author's agent names the units when it asks for the review: a title
  saying what the unit achieves, a line beneath it on what that code does, and the files —
  or `file:line` for one part of a file — it holds. A title that is a file name is refused,
  and the agent is told which changes its units leave out. What they leave out (and all of
  a review filed without units) goes under the decision that points at it most precisely —
  the section titled by that decision — a test with the code it tests (`Outbox.test.ts`
  with `Outbox.ts`), a sub-component in a folder below with the component using it. What
  no decision covers is **Not explained**, read last: a finding in itself, worth a
  question to the author.
- **Order.** Building blocks first: a unit comes before the units that import it, so you
  read what something is made of before what uses it. Otherwise the author's order.
- **Each unit**: what it achieves, the line on what it does, **Why:** the decisions that
  shaped it — each a chip that opens its full why beside the code — then how many changes
  in how many files, and its code: a file's changes under one header. A change no decision
  covers says so where it sits.
- **Beside it, the why in full**: the decisions that shaped this unit — each with its title, what
  was done, "Guided by …" naming any skill or agent file (`CLAUDE.md`, `AGENTS.md`) that
  told the agent to do it that way, how the person steered it (their words) and what their
  agent reasoned. A decision that shaped other units too links them. Then the **forks in
  the road** that fall in this unit — what was chosen over what, why, and whose call it was.
  It stays in view as you scroll; on a narrower window it folds under the title, a click
  away. When a decision also points at code the diff does not change, a quiet note says the
  why may be older than the branch.

Forks that fall in no change of the diff close the page. With no diff to read, the page
lists the decisions and where they point.

**Whole file**, on a hunk's header, opens the file as the branch has it — read from your
clone, never its working tree — every line numbered, this diff's added lines marked, scrolled
to the change; types and peeks work on it as on the hunk. "Just the change" folds it back.
It is offered when the diff came from your clone, and not on a deleted file.

**Viewed**, on each file's header, marks it as read, as on GitHub: the file folds to its
header everywhere it shows on the page, and the top of the decisions list counts how many
of the review's files you have viewed. A mark is for the file as you read it, at the branch's commit then —
when the author pushes a change to it, it opens again and says "changed since viewed", and
shows **only what moved since that commit**: each of its hunks shows the changes that fall in
it, a count of lines added and removed above them, and a hunk where nothing moved stays
folded, "unchanged since you viewed it". So three changed lines in an 800-line file are three
lines to read, not eight hundred. "Whole change" switches back to the diff against the base;
ticking Viewed again marks it as it is now. After a rebase the changes since include what the
new base brought in; if the branch was rewritten and that commit is gone, the page says so and
shows the whole change. It works when the diff came from your clone. Marks stay in your
browser, per review.

The plumbing stays out of the way: no decision ids, no pointer lists (each hunk names its
file), and where the diff came from is one line at the foot of the page.

## Types and definitions

On TypeScript, JavaScript and PHP files the code answers to the pointer, on added and
unchanged lines:

- a word you can ask about is underlined under the pointer, and the cursor says it can be
  clicked;
- **rest on it** and its type appears beside it — what a function takes and returns, what
  a value is — with the first paragraph of its doc comment (an overloaded function shows
  its first signature and how many more);
- **click it** to peek where it is declared, opened right under the line: its file and
  line, its doc comment as text (the first paragraph, "More" for the rest), then the
  declaration itself, coloured — long ones fold after eighteen lines, and further overloads
  or definitions fold under one line. It works the same for the branch's own code and for
  a package's types, Effect's or Solid's from your `node_modules`, Laravel's or Symfony's
  from your `vendor/`; a language's own functions say "built into TypeScript" or "built
  into PHP". `×`, Esc, or a second click closes it.

Each language's server is collagen's own, not the project's, pinned to one version and
not shipped with collagen. The first time a review has code in that language, the page
offers it, and only your click installs it — that exact version, from npm's registry, its
install scripts not run, into collagen's own folder (`~/.config/collagen/tools/`). `×` puts
the offer away in that browser; nothing changes for anyone who never clicks.

| Language | Server | The offer |
| --- | --- | --- |
| TypeScript, JavaScript | TypeScript `7.0.2`, run as `tsc --lsp` — whatever version the project uses, or none | "TypeScript type hints for this review? Installs TypeScript 7.0.2 (about 30 MB), once." |
| PHP | Intelephense `1.18.5`, run on the Node collagen already has — no PHP install needed | "PHP type hints for this review? Installs Intelephense 1.18.5 (about 150 MB), once. Not open source: Intelephense's licence." |

Intelephense is not open source. Hover and go to definition — all the page asks of it — are
in its free tier, so no licence key or purchase is needed; installing it means agreeing to
[its licence](https://intelephense.com/eula), which the offer links. Collagen never ships,
changes or bundles it, keeps its telemetry off (its default), and shows on the page any
message it asks to show you. It indexes the whole tree on start — your `vendor/` included —
before its first answer: under a second for a small project, longer for a large `vendor/`.

The project gives the code: the branch's commit is unpacked from your clone into a folder
of its own (`git archive`; your repository and its working tree are never touched), with
the clone's `node_modules` (beside each `package.json`) and `vendor/` (beside each
`composer.json`) linked in so imports resolve to what you have installed. A branch that
changes its dependencies is therefore checked against yours. The server starts
on the first hover (a moment), stays for the page, and stops after ten idle minutes.
Removed lines are the base's and are not asked about.

## Where the diff comes from

**Your own clone**, which is git, which is the source of truth: the project's folder on
your machine (the one you shared or located on the projects panel), `git fetch`, then
`git diff <base>...<branch>`, local refs first, then `origin/`. No host API, no copy of the
code anywhere new. When the ticket names no base, `main` is assumed.

When there is no clone to read — you have not located the project here, or the branch is
not in it — and the review's link is on GitHub, the page asks GitHub for the compare
through **your own `gh` login**, and says so at the top. Hosts sit behind one interface
(`RepoHost`, `apps/cli/src/services/RepoHost.ts`), GitHub the only one so far; they are also
where the page's back-links come from (the pull request, its checks, the compare), and what
the page acts on the pull request through (below). With neither, the page
lists the decisions and forks with their pointers, and says why there is no diff.

## The page itself

A small [Solid 2](https://github.com/solidjs/solid) app in `apps/review-web`, with
[TanStack Highlight](https://github.com/TanStack/highlight) for the code: each side of a
hunk (the old lines, the new lines) is tokenized as one block, so a string or comment that
opens on one line colours the next, and the tokens are rendered as the page's own spans —
nothing is ever set as HTML. About 28 KB gzipped. The cli build builds it and ships it in
`dist/review-web`; running collagen from source serves `apps/review-web/dist`
(`pnpm --filter @collagen/review-web build`). The page talks to your collagen through
Solid's server functions (`apps/review-web/src/api.ts`), not routes: each is called on the
page like a function and runs in collagen's own process, on its own services, through a
backend the page declares (`src/server/backend.ts`) and collagen provides when it loads the
page's server bundle. Reads are `GET`s Solid can cache; the review's state is a `live`
function the page holds open, so it reloads when the why, the ticket or the branch moves.
What they answer is typed once in `apps/review-web/src/data.ts`, which the cli imports.
Every argument is checked in collagen before it is used, calls from another origin are
refused, and only a request naming this machine is answered. The e2e scenarios stand a
fake `gh` in (`COLLAGEN_GH`), so no test ever reaches GitHub.

## On GitHub

When the review's code is on GitHub — its link names the repository or the pull request,
or your clone's remote does — the page acts on the pull request through **your own `gh`
login**. collagen keeps no token; whatever `gh` is signed in as is who the page acts as.

- **Who is signed in**, top right: the avatar and name a review or comment goes out under,
  seen before anything is sent. Not signed in, it says so and how (`gh auth login`).
- **The pull request**: the one the review's link names, else the one whose head is the
  review's branch (the open one, else the latest) — its number, state and decision, linked.
- **Review**: a box like GitHub's "Review changes" — your words, and Comment, Approve or
  Request changes (`gh pr review`). GitHub asks for words with anything but an approval,
  and lets you only comment on your own pull request; the page says both before sending.
- **Comments on lines**, as on GitHub: hover a line and a **+** shows at the code's edge;
  click it to comment on that line, or press it and drag down — or shift-click another
  line's + — for a block of lines in the same hunk, which stays marked while you write.
  **Suggest a change** puts the picked lines in a ```` ```suggestion ```` block to edit
  (new-side lines only, as on GitHub). The comment goes to that file and those lines **at
  the commit the page shows** (`gh api …/pulls/N/comments`), shows at once while it is
  sent, and stays in its box with GitHub's reason if GitHub refuses it (a line outside the
  pull request's diff, say). Everyone's line comments on the pull request sit under their
  (last) line; a suggested change shows as the lines it replaces and what it suggests, with
  its code to **copy** — GitHub has no way for another app to commit one. A comment GitHub
  no longer places on a line (the code under it moved) is left out.
- **The stack**: when the branch is built on another branch that is itself under review — a
  pull request whose base is another's head, or a review in the room naming that base — a
  row under the branch line shows the chain from the trunk up, this one, and what builds on
  it, each linked to its pull request or its review page.

- **What was said on GitHub**: everyone's line comments sit under their lines, a reply a
  step in under the comment it answers. Above the code, **On GitHub** lists the rest, oldest
  first — each review with its verdict (approved, changes requested, commented) and its words
  on the whole, the pull request's conversation, and line comments on code that has changed
  since, with where they were — the latest three, the rest a click away. Comments said in
  collagen (yours, your AI's once accepted, a colleague's) show with them, each once.
- **When GitHub is asked**: never on a timer. When the page opens; when the review moves (a
  push, a revision); after anything sent from the page; when you come back to the tab after a
  minute or more away; and on **↻ Refresh**, beside when it was last asked.

GitHub is a network and a login away: each part that cannot be read says why where it
would be, and the diff never waits for any of it (it is read in a call of its own). The
writes are not reads: Solid refuses them from any page but this one, so a site you visit
cannot send a review in your name; collagen finds the pull request from the ticket itself
and never takes a number from the page.

## Your review, as on GitHub

A review is written, then finished. Comments go into **your review** — pending, on your
machine only — and are said together when you **finish** it: **Finish review** (top right,
with how many are pending) takes your words on the whole and a verdict — Comment, Approve or
Request changes — and says every pending comment at once: **in the room** as yours (the
author's agent reads them in `review-context`) and, when the review has an open pull request,
**on it as one review**, through your own `gh`, under whoever `gh` is signed in as at that
moment — if that is no longer who the page showed, nothing is sent and the page says who it
is now. A refusal leaves the whole review pending. A finish is said once: sent again it
is not repeated, and one from a tab that no longer shows the review as it is (finished in
another tab, comments added or deleted since) is refused for you to look again. While a
finish is under way, nothing in the review can be changed or deleted. With no pull request the comments are said in the room
alone: a verdict, or words on the whole, would have nowhere to go, so the page asks for
neither. On **your own pull request** — the one you are signed in to `gh` as opened —
nothing is posted to GitHub, where you would be its only reader: your comments stay in
collagen, and the page says so. **Discard review** drops what is pending.

A review is of one commit: the one the page shows. A comment written before the branch moved
says **Written at …** under it, as its lines may not be the ones it meant; **Keep it here**
confirms it where it shows now, or delete it — until then, finishing refuses it. A comment
whose line the diff no longer shows at all — its file gone or renamed — is listed at the top
of the page, to delete or decline there. Should a
finish stop after GitHub has the review but before the room does, its comments stay marked
**On GitHub**; the next finish tells the room first, without posting them twice — and
anything new it brings (words, a verdict, comments) goes out as a review of its own.

On a line's composer, **Start a review** (then **Add review comment**) puts a comment in your
review; **Add single comment** says it at once, on its own, as GitHub's button does. A pending
comment sits under its line marked **Pending**, to edit or delete until you finish.

### Your AI's comments

Ask your agent to review the change and it reads the code, then leaves each remark about
particular lines as a **draft** on the page (`review-comments`), under the lines it is about
— not as a wall of text in the chat. A bar at the top says how many are waiting; each draft
is marked **Draft from your AI**, its suggested changes shown as changes, with **Add to
review**, **Edit** and **Decline**. Added, a draft is pending in your review like any comment
you wrote, and goes out when you finish it — marked **with AI** once said. Your agent can do
the same on your word ("looks good, post them": it adds them, then finishes the review),
never calling GitHub itself: collagen wires it.

## A review built from assumptions

For a change its author did not file in collagen — a colleague's pull request, say — ask
your agent to review it and it builds the review from **assumptions** (`assume-review`): it reads what it
can reach — the pull request's description and commits, the tickets it links (a Jira or
Linear ticket, through whatever tools it has), the code — and infers what the change cannot
say: the problem behind it, and why the author solved it this way. From there it is a review
like any other — you judge the code, comment on its lines, have your agent draft comments,
and finish it — with the guesses standing where the author's decisions would:

- a banner says it is an assumption-based review, and whose;
- every guess carries its mark and **how sure** the AI is of the reason (high: someone said
  why; medium: the evidence points there; low: a hunch from the code), what it **rests on**,
  and the AI's reading — in place of the person's words a told decision has; its chip beside
  the code is dashed.

The ticket is yours to read: your review step, and nobody to address it, since its author
did not file it. Your agent adds to the assumptions with `assume-review` as it learns more — corrects one,
or withdraws one that turned out wrong; it stays the same review.

**When the author joins**, their agent can take the review over (`claim-review`) — only
theirs: they must share an identity with whoever wrote the code — signed in to the code's
host as the pull request's author, or committing in their clone as one of the emails on its
commits. Git alone is enough, so it works for code on no host at all. They
answer each guess: **confirmed**, **corrected** (the real decision in its place, with the
real reason), or **wrong** (and why); and they add what the guesses missed. From then on it
is their review, amended with `ask-review` like any other, and its guesser can no longer
change it. Every reader sees each answer: a confirmed guess reads as a decision, a corrected
one shows what the AI had guessed beside it, a wrong one is struck through; one they did not
answer is still a guess. On the room's log a review taken over always wins over the guesses,
however the copies arrive.

## Saying what you think

A review sent from the page reviews the **pull request**. Your take on the collagen ticket
goes back the way everything in collagen does — through your agent, in your words, with
`post-review` — so there is one path into the room's log, and it is yours.
