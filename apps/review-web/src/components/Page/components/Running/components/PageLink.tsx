import type { Show } from "~/data";
import { where } from "../where";

/** A page the change touches, opened in a new tab, with where it runs. */
export function PageLink(props: { show: Show }) {
  return (
    <p class="running-row">
      <a href={props.show.url} target="_blank" rel="noreferrer">
        {props.show.title} ↗
      </a>
      <span class={["running-where", { local: props.show.local }]}>{where(props.show)}</span>
    </p>
  );
}
