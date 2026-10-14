import type { ReviewPageData } from "~/data";
import { Arrives } from "~/components/Arrives";
import { Body } from "./components/Body";
import { Unit } from "./components/Unit";

/** Everything under the header that waits on the diff: the units with their
 *  code and why, the decisions and forks outside it, and the page's footer.
 *  It arrives the moment the diff is read. */
export function Diff(props: { data: ReviewPageData }) {
  return (
    <Arrives skeleton={Diff.Skeleton}>
      <Body data={props.data} />
    </Arrives>
  );
}

/** The code not read yet: the first unit's shape. */
Diff.Skeleton = function Skeleton() {
  return <Unit.Skeleton />;
};
