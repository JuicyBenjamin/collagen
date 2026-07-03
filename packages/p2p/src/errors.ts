import { Data } from "effect";

export class PeerNotConnected extends Data.TaggedError("PeerNotConnected")<{
  readonly peerKey: string;
}> {}

export class SwarmError extends Data.TaggedError("SwarmError")<{
  readonly cause: unknown;
}> {}
