import type { Fork as ForkData } from "../data";

/** A fork in the road: where, what was chosen over what, why, whose call. */
export function Fork(props: { fork: ForkData }) {
  return (
    <div class="forkbox">
      <div class="at">
        {props.fork.id} · {props.fork.at}
      </div>
      <div>chose {props.fork.chose}</div>
      <div class="instead">instead of {props.fork.instead}</div>
      <div class="by">
        {props.fork.why}
        {props.fork.by ? ` · ${props.fork.by === "user" ? "the person's call" : "the agent's call"}` : ""}
      </div>
    </div>
  );
}
