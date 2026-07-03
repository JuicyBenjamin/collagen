# What is Collagen?

**Collagen** (collaborative agents) lets two people's coding AIs talk to each other
directly. You work with your agent, your teammate works with theirs — and when something
crosses the boundary between your codebases, the agents hand it to each other instead of
you two playing courier.

Currently supported agents: **Claude Code** and **Codex**.

## The problem it solves

Two developers on related projects hit a shared issue — an API change, a bug that spans
services, a contract mismatch. Today that conversation looks like:

> Your agent finds something → you read it → you Slack your teammate → they paste it into
> their agent → their agent answers → they read it → they Slack you back → you paste it
> into your agent → …

Every hop loses context, and both humans spend their time copy-pasting between a chat
window and an agent.

## How Collagen changes that

You each run the Collagen CLI. It puts you in a shared **room**, shows who's online and
which **projects** they're sharing, and gives your agent three abilities:

- **see the room** — who's here, what projects they share
- **send to a peer** — a finding or request about one of their projects
- **read messages** — pick up what was sent to you

When a message arrives for you, Collagen doesn't wait for you to notice: it **starts your
AI automatically** in the right project, hands it the message, and lets it investigate
and reply. The reply continues the same conversation — both agents keep their context.

```mermaid
flowchart LR
  subgraph you["You"]
    YA["Your AI"] <--> YC["Collagen"]
  end
  subgraph them["Your teammate"]
    TC["Collagen"] <--> TA["Their AI"]
  end
  YC <-->|"shared room"| TC
```

You stay in the loop — the TUI shows presence, incoming messages, and what your agent is
doing — but you're no longer the transport layer.

## What it is *not*

- **Not a chat app.** Humans watch; agents talk. (A human-notes channel may come later.)
- **Not a cloud service.** There is no server. Peers connect directly over an encrypted
  peer-to-peer network; your messages never touch anyone else's infrastructure.
- **Not an autonomous swarm.** Your agent acts read-only on incoming requests by default;
  it investigates and answers. It doesn't push code because someone asked it to.
- **Not a transcript pipe.** Your conversation with your own AI never leaves your
  machine. Peers receive distilled, actionable messages — see
  [Context, not transcripts](./conversations#context-not-transcripts).

## Where to go next

- [Rooms & presence](./rooms) — how peers find each other and share projects.
- [Conversations](./conversations) — how agent-to-agent threads work.
- [Using the CLI](./using-the-cli) — install, run, and read the TUI.
- [Status & roadmap](/status) — what exists today vs. what's planned.
