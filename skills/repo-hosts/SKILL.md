---
name: repo-hosts
description: Use when writing anything in collagen that touches where code is hosted — pull requests, comments, reviews, sign-in, branch links, refs, who wrote some code — or any user-facing word that names a host. GitHub through gh is the first host, never the only one: everything host-specific lives behind RepoHost, so adding GitLab is one implementation, not a rewrite.
---

# Repo hosts

Collagen works with git first and a host second. Today the host is GitHub,
through the person's own `gh`; tomorrow it may be GitLab or Gitea. Adding one
must mean writing **one more `RepoHost`** in `HOSTS` — its CLI or API, its
URLs, its refs, its words — and nothing else in collagen changing.

## The rules

1. **Only a `RepoHost` knows the host.** Its tool (`gh`), its API shapes
   (`lib/github.ts`), its URL layout (`branchUrl`), where it keeps a pull
   request's head (`pullRef`), how it says "finish your review" (`submit`).
   Nothing outside `services/RepoHost.ts` and the host's own `lib/<host>.ts`
   imports them or spells them out. Need something new from the host? Add a
   method to the interface, and implement it for every host.
2. **Speak the interface, not the host.** Callers take `hostOf(link)` and use
   what it returns; no `if (github)` anywhere. A link no host matches still
   works with git alone (the clone's diff, the room's comments), and says what
   it cannot do.
3. **Words come from the host.** "On GitHub", "GitHub asks for it", "gh is
   signed in as" are wrong in shared code: use `host.name` (the page:
   `hostNow.hostName()`). Generic terms where no host is known: "the host",
   "the pull request". Code comments may say "as on GitHub" — they explain,
   they are not shown.
4. **Identity is not a host login.** Who someone is, or who wrote some code,
   is a set of identities: `"<host id>:<login>"` (`identityOf(host.id, …)`)
   and `"git:<email>"` from the commits (`gitAuthors`, `ownIdentities` in
   `services/Authorship.ts`). Two people are the same author when they share
   one. Git works with no host at all; a new host adds its kind for free.
5. **Refs and links through the host.** A fork's pull request is read as
   `pr/<n>`, fetched from `host.pullRef(n)`; a branch's page is
   `host.branchUrl(repo, branch)` (`branchLink`). Never build either by hand.
6. **Test with a stand-in.** The e2e scenarios swap the host's tool for a fake
   (`COLLAGEN_GH` → `e2e/fake-gh.mjs`); a new host gets its own fake, and
   nothing in a test reaches a real host.

## Bugs this would have caught

- A fork's head was fetched from `refs/pull/<n>/head` inside the clone
  reader — GitHub's ref, in code every host shares.
- Taking over an assumed review checked only "the gh login is the pull
  request's author": no host, no proof; another host, a rewrite.
- "On GitHub", "GitHub asks for it" and "gh is signed in as" were written
  into the review page and the agents' messages.
- Branch links were built as `<repo>/tree/<branch>` in `lib/gitInfo.ts`.

## Checklist

- [ ] Does this code name a host, its CLI, its URLs or its refs outside `RepoHost`?
- [ ] Would a second host need this file changed? Then it belongs behind the interface.
- [ ] Does any shown text say "GitHub" or "gh"? Use the host's name.
- [ ] Does it decide who someone is? Use identities, with git as the floor.
