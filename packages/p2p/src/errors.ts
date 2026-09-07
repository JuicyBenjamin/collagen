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
