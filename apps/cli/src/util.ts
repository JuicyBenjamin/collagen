/** Deterministic local port per profile, so the MCP URL is stable across runs
 *  (different profiles → different ports, so two local instances don't clash). */
export function portForProfile(profile: string): number {
  let h = 0;
  for (const c of profile) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 41000 + (h % 4000); // 41000–44999
}

/** MCP server name: `collagen` in prod (default profile), `collagen-<profile>`
 *  for dev so two local instances coexist in Claude's config. */
export function mcpServerName(profile: string): string {
  return profile === "default" ? "collagen" : `collagen-${profile}`;
}
