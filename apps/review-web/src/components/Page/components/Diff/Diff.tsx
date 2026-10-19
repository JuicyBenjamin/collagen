import type { ReviewPageData, ReviewPageHead } from "~/data";
import { Arrives } from "~/components/Arrives";
import { Body } from "./components/Body";
import { Tabs } from "./components/Body/components/Tabs";
import { Unit } from "./components/Unit";
import { lastTabs } from "./lastTabs";

/** Everything under the header that waits on the diff: the units with their
 *  code and why, the decisions and forks outside it, and the page's footer.
 *  It arrives the moment the diff is read. */
export function Diff(props: { head: ReviewPageHead; data: ReviewPageData }) {
  return (
    <Arrives skeleton={() => <Diff.Skeleton head={props.head} />}>
      <Body data={props.data} />
    </Arrives>
  );
}

/** The code not read yet: its tabs — how it works when the review has a
 *  machine, the tests as last time — and the first unit's shape. The page's
 *  own placeholder, before even the head is read, has the code's tab alone. */
Diff.Skeleton = function Skeleton(props: { head?: ReviewPageHead }) {
  return (
    <>
      <Tabs.Skeleton machine={props.head?.review.machine !== undefined} tests={lastTabs.last?.tests ?? 0} />
      <Unit.Skeleton />
    </>
  );
};
