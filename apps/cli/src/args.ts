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
  Flag.withDescription("Room to join — peers meet by using the same room name (treat it as a shared secret)"),
  Flag.withDefault("lobby"),
);
