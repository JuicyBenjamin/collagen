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
