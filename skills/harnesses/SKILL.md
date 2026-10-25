---
name: harnesses
description: Use when writing anything in collagen that touches an AI tool a person works in — Claude Code, Codex, or one added later — telling which one called, which of its conversations, reaching or waking that conversation, its session files, transcripts, token use or sign-in, or any word that names one. Everything harness-specific lives behind the Harness interface, so adding Gemini CLI is one implementation, not edits across the app.
---

# Harnesses

A harness is the AI tool a person works in: Claude Code (terminal or desktop
app), Codex (terminal or the Codex app), and whichever comes next. Collagen
needs the same things from each — who called and from which conversation, how
to wake that conversation in the window the person is in, where its sessions
live — and every harness answers differently. Adding one must mean writing
**one more `Harness`** and putting it in `HarnessesLive`, nothing else changing.

## The rules

1. **Only a `Harness` knows the harness.** Its `_meta` keys
   (`claudecode/toolUseId`, `threadId`, `x-codex-turn-metadata`), its session
   log format (token use, transcript lines, the lines a slice always keeps),
   its messaging socket, its CLI (`claude`, `codex queue`), where and how
   collagen registers with it, its sign-in check, its env overrides. They
   live in `services/harnesses/<name>/` and nowhere else: shared code keeps
   only the machinery a harness feeds (`Reader` in `lib/tokenCost.ts`,
   `textOf` in `lib/transcripts.ts`). Need something new from a harness? Add
   it to the interface in `services/Harness.ts`, and implement it for every
   harness.
2. **Speak the interface, not the name.** Callers look one up
   (`harnessFor(harnesses, id)`, `harnessOfClient(harnesses, clientName)`)
   and use what it gives; no `if (ai === "codex")` anywhere. A client no
   harness matches still acts, by name, with no conversation.
3. **Harnesses come from the layer, always.** Services, atoms and
   diagnostics take `yield* Harnesses` (provided by `HarnessesLive`); tests
   provide `HarnessesLive` or build their own list from the implementations.
   There is no constant to reach for and no default to fall back on, so code
   that skips the layer does not compile. Lists that depend on the harnesses —
   the AI a person can pick, the mocks, the tool calls a session made — are
   derived from them, never typed out.
4. **Words come from the harness.** `harness.name` ("Claude Code"),
   `harness.wakesBy`, `harness.watchRecipe` — never a harness's name typed
   into shared text.
5. **Read from the call, never the agent's word.** `readCall` and `reachOf`
   read what the call itself carries (its `_meta`, its connection). An agent
   typing its own conversation id or address is refused or ignored.
6. **Waking goes through steering.** `wake` requires `DeliverAllowed`
   (skill: steering): a harness never wakes a conversation the person did not
   allow. One line, from collagen, never passed off as the person's words.
7. **Its id is on shared records.** `Conversation.ai` is the `Harness` literal
   in `@collagen/p2p`: a new harness adds its id there too, which is a change
   to what peers write (skill: replicated-merges).

## Bugs this would have caught

- Harness names spread over ten files: client names in `agents.ts`, `_meta`
  parsing beside them, sockets in a lib of their own, `if codex … else
  courier` in the runner, literals in three MCP tools, two session layouts in
  the transcript and token code.
- Spawn adapters for real harnesses kept after their only use (the background
  resume) was removed, because nothing tied them to the harness.
- Two wake texts for two harnesses drifting apart: Codex's carried the
  human-in-the-loop rules, Claude Code's courier line did not. One `wakeLine`
  for every harness; the harness only says how it is delivered.

## Checklist

- [ ] Nothing outside `services/harnesses/` names a harness, its `_meta` keys, its CLI or its files.
- [ ] New harness behaviour is a method on `Harness`, implemented for every harness.
- [ ] Everything gets harnesses from the `Harnesses` layer; nothing lists them by hand.
- [ ] Waking requires the delivery permit.
- [ ] A new harness: its folder, its entry in `HarnessesLive`, its id in the p2p `Harness` literal.
