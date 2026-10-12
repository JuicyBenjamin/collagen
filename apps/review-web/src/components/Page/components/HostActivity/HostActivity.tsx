import type { ReviewPageHead } from "~/data";
import { Arrives } from "~/components/Arrives";
import { Masked } from "~/components/Masked";
import { hostNow } from "~/hostNow";
import { Said } from "./components/Said";
import { lastActivity } from "./lastActivity";

/** What has been said on the pull request apart from its lines. It waits on
 *  the host: where it stood last time (or on a first open, when the review
 *  links a pull request), its placeholder holds its place until the host
 *  answers; where it did not, it opens into place if a pull request comes —
 *  a placeholder for a part that never comes would leave a hole to close. */
export function HostActivity(props: { head: ReviewPageHead }) {
  const expected = lastActivity.last?.shown ?? /\/pull\/\d+/.test(props.head.review.link ?? "");
  return expected ? (
    <Arrives skeleton={HostActivity.Skeleton} ready={hostNow.view() !== null}>
      <Said />
    </Arrives>
  ) : (
    <Said />
  );
}

/** Its head — where, what was said, when it was checked — and, when there
 *  were comments last time, the row that unfolds them. */
HostActivity.Skeleton = function Skeleton() {
  return (
    <section class="host-activity sk" aria-hidden="true">
      <div class="host-head">
        <h2>
          <Masked>On GitHub</Masked>
        </h2>
        <span class="host-counts">
          <Masked>nothing said on #10 yet</Masked>
        </span>
        <span class="host-checked">
          <Masked>checked just now</Masked>
        </span>
        <span class="btn btn-xs sk-button">
          <Masked>↻ Refresh</Masked>
        </span>
      </div>
      {lastActivity.last?.talked ? (
        <div class="host-fold">
          <span class="avatar sk-avatar" />
          <Masked>2 reviews · 3 comments</Masked>
        </div>
      ) : null}
    </section>
  );
};
