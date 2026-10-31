---
name: releasing
description: Use when starting, merging or shipping work in collagen's GitButler workspace — a new branch, a branch approved in review, a batch going out. Work branches off `release`, each merged into `release` once its person approves, and `release` goes into `main` as one pull request. Never stack unrelated branches to move `release` forward.
---

# Releasing

Collagen ships in batches. Every piece of work is its own GitButler branch,
reviewed on its own collagen review ticket, and merged into the `release`
branch when its person says so. When the batch is done, `release` goes into
`main` as one pull request. `release` only ever moves by a merge the person
approved.

## The rules

1. **The workspace's target is `origin/release`.** `but config target`
   shows it. If it says `origin/main`, or `release` does not exist yet
   (after a batch shipped): create `release` from `main`'s tip
   (`gh api -X POST repos/<owner>/<repo>/git/refs -f ref=refs/heads/release -f sha=<main>`),
   unapply every branch (GitButler changes target only with none applied;
   pushed branches lose nothing), `but config target origin/release`, then
   `but pull`.
2. **One branch per piece of work, off `release`.** `but commit -b <branch>`.
   Branches stay side by side. Stack one on another only when it builds on
   that branch's code, or the two conflict (resolve the conflict in the
   stack: skill gitbutler). Never stack to put branches "in release order".
3. **Merging is the person's call, one branch at a time.** On their OK:
   `but push <branch>`, then merge it into `release` on the host
   (`gh api -X POST repos/<owner>/<repo>/merges -f base=release -f head=<branch>`),
   then `but pull`: GitButler sees it landed, clears it, and moves the other
   branches onto the new `release`. A stack merges bottom branch first.
   Then close the tickets it touched, as the person's `close` steering says
   (`set-steering` lists it): just do it, close them; act, close them and say
   so; ask first, ask; never, leave them open.
4. **Never move `release` by hand.** No force push, no pointing its ref at
   a branch's tip, no fast-forward to a stack you built for the purpose.
5. **Shipping is one pull request.** `release` into `main`
   (`gh pr create --base main --head release`), its CI watched, merged as
   the person says (a rebase merge, as before). The next batch starts at
   rule 1.

## Bugs this would have caught

- Six reviewed branches stacked on each other in "release order" and
  `release` fast-forwarded to the top of the stack: the right content, by
  the wrong road — every branch tied to the ones under it, and `release`
  moved by hand instead of by merges.
- The workspace still targeting `origin/main` mid-batch, so each new branch
  started from `main` and had to be rebased onto the others to be merged.

## Checklist

- [ ] `but config target` is `origin/release`.
- [ ] Each piece of work is its own branch off `release`, stacked only when it must be.
- [ ] A branch goes into `release` by a merge, on its person's OK, then `but pull`.
- [ ] `release` reaches `main` by one pull request.
