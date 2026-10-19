import type { ReviewPageHead } from "~/data";
import { floating } from "~/floating";
import { DialButtons, DialPanel } from "../../../ReviewDial";
import { Progress } from "./components/Progress";

/** Under the header's top line, on the right: one pill holding how far
 *  through the files the reader is and the buttons that finish the review —
 *  the same pill the corner holds once this one has scrolled away, and it
 *  flies there (floating.ts), leaving its place here empty until it flies
 *  back. The open panel under it. */
export function HostBar(props: { head: ReviewPageHead }) {
  return (
    <div class="host-bar">
      {/* while it is in the corner its place here stays, empty: one pill, never two */}
      <div class="pill-outer" style={{ "view-transition-name": floating() ? "none" : "review-pill", visibility: floating() ? "hidden" : undefined }}>
        <span class="pill-inner">
          <Progress />
        </span>
        <DialButtons head={props.head} />
      </div>
      <DialPanel head={props.head} where="bar" />
    </div>
  );
}

/** The pill before the diff is read: the count's placeholder, and the
 *  buttons' places. */
HostBar.Skeleton = function Skeleton() {
  return (
    <div class="host-bar">
      <div class="pill-outer sk" aria-hidden="true">
        <span class="pill-inner">
          <Progress.Skeleton />
        </span>
        <span class="dial-buttons">
          <span class="dial sk-button" />
          <span class="dial sk-button" />
          <span class="dial sk-button" />
        </span>
      </div>
    </div>
  );
};
