import { Flag } from "effect/unstable/cli";

// Shared flag definitions for both entrypoints (TUI + headless).
export const profileOption = Flag.string("profile").pipe(
  Flag.withAlias("p"),
  Flag.withDescription("Config profile (separate identity/state; used for local dev pairs)"),
  Flag.withDefault("default"),
);

export const nameOption = Flag.string("name").pipe(
  Flag.withAlias("n"),
  Flag.withDescription("Display name shown to peers (persisted per profile)"),
  Flag.optional,
);

export const roomOption = Flag.string("room").pipe(
  Flag.withAlias("r"),
  Flag.withDescription("Room to join — peers meet by using the same room name (treat it as a shared secret). Overrides the room stored in the profile; the TUI asks on first run."),
  Flag.optional,
);

/** pnpm ≥7 forwards the `--` separator into argv verbatim (`pnpm dev -- --profile x`
 *  reaches us as [..., "--", "--profile", "x"]), and @effect/cli rejects the bare
 *  `--`. Drop the first one so both `pnpm dev -- --flag` and `pnpm dev --flag` work. */
export function stripArgSeparator(argv: ReadonlyArray<string>): string[] {
  const i = argv.indexOf("--");
  return i === -1 ? [...argv] : [...argv.slice(0, i), ...argv.slice(i + 1)];
}
