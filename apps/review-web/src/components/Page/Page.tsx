import type { ReviewPageData, ReviewPageHead } from "~/data";
import { Diff } from "./components/Diff";
import { Header } from "./components/Header";
import { HostActivity } from "./components/HostActivity";
import { Outline } from "./components/Outline";

// One section per unit — what it achieves, a line on what it does, the
// decisions that shaped it, then its code, each change shown once; beside
// it, quieter, the full why (how the person steered each decision, what
// their agent reasoned) and the forks in the road. Last, the changes no
// decision covers: "Not explained", itself a finding. Ids, pointers and
// where the diff came from are plumbing — kept out of the reader's way.
// Read-only: a take goes back through the person's agent (post-review).
//
// It builds as it loads: each part stands on its own read (the head from
// the room, the diff, the host) and arrives as soon as that is in.

/** The review page: the outline beside, the review's header, what was said
 *  on its host, and its code. */
export function Page(props: { head: ReviewPageHead; data: ReviewPageData }) {
  return (
    <div class="wrap">
      <nav aria-label="Outline">
        <Outline data={props.data} />
      </nav>
      <main>
        <Header head={props.head} />
        <HostActivity />
        <Diff data={props.data} />
      </main>
    </div>
  );
}

/** The page before anything is read: its parts' own placeholders. */
Page.Skeleton = function Skeleton() {
  return (
    <div class="wrap">
      <nav aria-label="Outline">
        <Outline.Skeleton />
      </nav>
      <main>
        <Header.Skeleton />
        <Diff.Skeleton />
      </main>
    </div>
  );
};
