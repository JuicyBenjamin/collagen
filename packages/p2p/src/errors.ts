import { Data } from "effect";

export class PeerNotConnected extends Data.TaggedError("PeerNotConnected")<{
  readonly peerKey: string;
}> {}

export class SwarmError extends Data.TaggedError("SwarmError")<{
  readonly cause: unknown;
}> {}

/** You are in the room but not (yet) admitted to its log: nothing can be
 *  appended until a member who is online adds your writer core. */
export class NotWritable extends Data.TaggedError("NotWritable")<{
  readonly roomId: string;
}> {}

/** An append to the room's log failed (Autobase refused or the store errored). */
export class LogAppendFailed extends Data.TaggedError("LogAppendFailed")<{
  readonly cause: unknown;
}> {
  override get message(): string {
    return this.cause instanceof Error ? this.cause.message : String(this.cause);
  }
}
