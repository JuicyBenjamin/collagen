---
name: review
description: Use when reviewing a change in collagen — a diff, branch or pull request, yours or someone else's — before approving it or calling it done. Lists what to check beyond "does it work"; grows as reviews find new things worth catching.
---

# Review

Read the diff for what it does, then run it through each check below. A check
is only here because a real change got it wrong once.

## Checks

### Leaky abstractions

A service owns one job. Behaviour that belongs to it must live inside it, not
be rebuilt around it by its callers. When callers extend a service from the
outside, the service stops being the single place to change, and the next
change has to find every copy.

Look for, in the diff:

- A caller that does work the service should do: parsing, filtering, mapping,
  formatting or retrying a result the service handed back.
- The same logic about one service's data in two or more callers.
- A caller that reaches past the interface: the service's tool, API shapes,
  files or internals imported or spelled out outside it.
- `if` on what kind of service or host it is, in code that should only call
  the interface.
- A new helper beside a service that is really a missing method on it.

When found, move the behaviour into the service (a new method, implemented for
every variant) and have callers call that. If it truly belongs elsewhere, say
why in the review.

Example: `repo-hosts` — everything host-specific lives behind `RepoHost`;
code outside it that spells out `gh` or a URL layout is this bug.

## Reporting

Name the file and line, say which check it breaks, and say what to do instead.
One finding per problem.

## Growing this skill

When a review finds something that could come back, add it as a check here in
the same change: a short rule, why it matters, what to look for.
