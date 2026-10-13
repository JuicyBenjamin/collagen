---
name: types-not-checks
description: Use when writing or changing any function in collagen that takes a value with a known set of shapes — a language, a kind, a status, a mode, an option — or that normalizes or checks its input (toLowerCase, trim, includes, a fallback chain of comparisons). Values we pick are typed and passed as they are; only what comes from outside is read, once, where it comes in.
---

# Types, not checks

This is TypeScript with Effect. When we choose a value, the type says what it
can be, and the code passes exactly that. Converting a value we chose and then
checking the result is ugliness with no upside: it hides what the function
takes, it accepts what it should refuse, and every caller pays for it.

## The rule

- **A value from a known set is a union type**, not `string`:
  `type Language = "ts" | "tsx" | … | "plaintext"`. The signature names the
  options; the compiler holds every caller to them.
- **Pass the right value; never repair it inside.** No `toLowerCase`, `trim`,
  `includes(".")` or "is it a name or an extension" guessing on a parameter we
  control. If a caller has a file name, it calls `languageOf(file)` first and
  passes the result.
- **Outside input is read once, at the edge.** Text a person or another
  program wrote — a comment's code fence, a language server's reply, a host's
  JSON, a file on disk — is parsed where it enters (a schema, or a small
  function like `fenceLanguage(name): Language`), and from there on it is the
  typed value. The reading is in one place, named, and the only place a
  string becomes the type.
- **No defensive checks on typed values.** If the type says it cannot be
  `null`, do not test for `null`. If it can, the type says so.
- **A lookup table is typed too**: `Record<string, Language>` for outside
  names in, never a table that maps strings to more strings.

## Bugs this would have caught

- `highlightCode(code, lang: string)` lowercased `lang`, then guessed whether
  it was a file name, an extension or a language name, on every call — for
  values every caller already knew. Now `highlightCode(code, lang: Language)`;
  `languageOf(file)` and `fenceLanguage(name)` are the only two ways in.

## Checklist

- [ ] Does any parameter typed `string` really have a fixed set of values? Make it a union.
- [ ] Is anything normalized or re-checked inside a function whose caller we write? Fix the caller instead.
- [ ] Is outside text turned into the type in exactly one named place, where it comes in?
