import type { Net } from "@collagen/p2p";
import { NET } from "../app/net";

/** Deterministic local port per profile AND net, so the MCP URL is stable
 *  across runs and the installed app and a run from source on the same profile never
 *  fight over a port (different profiles → different ports too). Mirrored by
 *  `port_of` in e2e/lib.sh. */
export function portForProfile(profile: string, net: Net = NET): number {
  const key = net === "devnet" ? `${profile}@devnet` : profile;
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 41000 + (h % 4000); // 41000–44999
}

/** MCP server name as the agents' configs know it: `collagen` for the
 *  installed app, `collagen-devnet` for a run from source, `-<profile>` appended
 *  for any profile but the default — so every local instance coexists in
 *  Claude's and Codex's config. */
export function mcpServerName(profile: string, net: Net = NET): string {
  const base = net === "devnet" ? "collagen-devnet" : "collagen";
  return profile === "default" ? base : `${base}-${profile}`;
}
