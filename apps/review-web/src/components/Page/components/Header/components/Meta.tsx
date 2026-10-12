import { For, Show } from "solid-js";
import type { ReviewPageHead } from "~/data";
import { Arrives } from "~/components/Arrives";
import { Masked } from "~/components/Masked";

/** Where the review is: its branch into its base, who it is by, and its
 *  links (the pull request, the comparison). */
export function Meta(props: { head: ReviewPageHead }) {
  // which of the author's agents wrote it, when one did
  const via = () => (props.head.review.agent ? ` via ${props.head.review.agent}` : "");
  return (
    <Arrives skeleton={Meta.Skeleton}>
      <p class="meta">
        <Show when={props.head.review.branch}>
          {(branch) => (
            <>
              <code>{branch()}</code> into <code>{props.head.review.base ?? "main"}</code> ·{" "}
            </>
          )}
        </Show>
        <Show when={props.head.review.assumed} fallback={<>by {props.head.review.authorName}{via()}</>}>
          {(assumed) => (
            <Show when={props.head.review.claimed} fallback={<>by {assumed().author}</>}>
              <>by {props.head.review.authorName}{via()}</>
            </Show>
          )}
        </Show>
        <For each={props.head.links}>
          {(link) => (
            <>
              {" · "}
              <a href={link.url} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            </>
          )}
        </For>
      </p>
    </Arrives>
  );
}

Meta.Skeleton = function Skeleton() {
  return (
    <p class="meta sk" aria-hidden="true">
      <Masked>the-branch into main · by its author · on GitHub</Masked>
    </p>
  );
};
