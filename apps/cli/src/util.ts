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

/** pnpm ≥7 forwards the `--` separator into argv verbatim (`pnpm dev -- --profile x`
 *  reaches us as [..., "--", "--profile", "x"]), and @effect/cli rejects the bare
 *  `--`. Drop the first one so both `pnpm dev -- --flag` and `pnpm dev --flag` work. */
export function stripArgSeparator(argv: ReadonlyArray<string>): string[] {
  const i = argv.indexOf("--");
  return i === -1 ? [...argv] : [...argv.slice(0, i), ...argv.slice(i + 1)];
}

/** A room invite id is a uuid (v7 in practice). The setup wizard rejects
 *  anything else so a botched paste can't silently become a brand-new room. */
export function isRoomInviteId(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
