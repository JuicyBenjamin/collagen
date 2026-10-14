import type { ReviewPageHead } from "~/data";
import { Arrives } from "~/components/Arrives";
import { Masked } from "~/components/Masked";
import { Assumed } from "./components/Assumed";
import { Headline } from "./components/Headline";

/** What the change is for: its headline, the line beneath, and — when the
 *  why was guessed — whose guess it is. Read from the room, it is in before
 *  anything waits on the diff. */
export function Purpose(props: { head: ReviewPageHead }) {
  return (
    <Arrives skeleton={Purpose.Skeleton}>
      <Headline head={props.head} />
      <Assumed head={props.head} />
    </Arrives>
  );
}

/** A headline of a few words, and the two lines beneath it most summaries take. */
Purpose.Skeleton = function Skeleton() {
  return (
    <div class="sk" aria-hidden="true">
      <h1 class="purpose">
        <Masked>What this change is for, in a few words</Masked>
      </h1>
      <p class="summary">
        <Masked>
          What is different for whoever uses it once it lands, in a sentence or two that most often
          runs onto a second line.
        </Masked>
      </p>
    </div>
  );
};
