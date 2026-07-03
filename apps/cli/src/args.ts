import { Options } from "@effect/cli";

// Shared flag definitions for both entrypoints (TUI + headless).
export const profileOption = Options.text("profile").pipe(
  Options.withAlias("p"),
  Options.withDescription("Config profile (separate identity/state; used for local dev pairs)"),
  Options.withDefault("default"),
);

export const nameOption = Options.text("name").pipe(
  Options.withAlias("n"),
  Options.withDescription("Display name shown to peers (persisted per profile)"),
  Options.optional,
);
