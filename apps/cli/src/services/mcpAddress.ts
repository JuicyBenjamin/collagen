import type { Net } from "@collagen/p2p";
import { NET } from "../app/net";

/** Deterministic local port per profile, in a range per net — mainnet
 *  41000–44999, devnet 45000–48999 — so the MCP URL is stable across runs,
 *  different profiles get different ports, and the installed app and a run
 *  from source on the same profile can never land on one port (a shared range
 *  would let the two hashes collide). Mirrored by `port_of` in e2e/lib.sh. */
export function portForProfile(profile: string, net: Net = NET): number {
  let h = 0;
  for (const c of profile) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (net === "devnet" ? 45000 : 41000) + (h % 4000);
}

/** MCP server name as the agents' configs know it: `collagen` for the
 *  installed app, `collagen-devnet` for a run from source, `-<profile>` appended
 *  for any profile but the default — so every local instance coexists in
 *  Claude's and Codex's config. */
export function mcpServerName(profile: string, net: Net = NET): string {
  const base = net === "devnet" ? "collagen-devnet" : "collagen";
  return profile === "default" ? base : `${base}-${profile}`;
}
