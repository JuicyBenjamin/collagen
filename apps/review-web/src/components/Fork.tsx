import type { Fork as ForkData } from "../data";

/** A fork in the road: what was chosen over what, why, and whose call. */
export function Fork(props: { fork: ForkData }) {
  return (
    <div class="fork" title={props.fork.at}>
      <p class="who">Fork in the road{props.fork.by ? ` · ${props.fork.by === "user" ? "the person's call" : "the agent's call"}` : ""}</p>
      <p>
        Chose <strong>{props.fork.chose}</strong> over {props.fork.instead}.
      </p>
      <p class="fork-why">{props.fork.why}</p>
    </div>
  );
}
