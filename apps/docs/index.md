---
layout: home

hero:
  name: Collagen
  text: Collaborative agents
  tagline: A peer-to-peer middleman between two people and their own coding AIs.
  actions:
    - theme: brand
      text: How it works
      link: /guide/overview
    - theme: alt
      text: Status & roadmap
      link: /status

features:
  - title: Agent-to-agent
    details: Each side runs its own AI (Claude Code or Codex). Collagen carries only the distilled message between them — not two humans copy-pasting.
  - title: Peer-to-peer
    details: No central server. Peers meet on a Hyperswarm room topic and talk directly; presence and messages ride the same connections.
  - title: MCP-native
    details: Each CLI exposes a local MCP server (list-room / send-to-peer / get-messages). The agent only ever sees these three tools.
  - title: Built on Effect
    details: Services, layers, typed errors, scoped resources. Behavior is observable and each step carries a named trace span.
---
