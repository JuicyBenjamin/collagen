import type { ReviewPageHead } from "~/data";
import { DraftsBar } from "./components/DraftsBar";
import { HostBar } from "./components/HostBar";
import { Pull } from "./components/HostBar/components/Pull";
import { Viewer } from "./components/HostBar/components/Viewer";
import { Meta } from "./components/Meta";
import { Purpose } from "./components/Purpose";
import { StackRow } from "./components/StackRow";
import { Unplaced } from "./components/Unplaced";

/** The review's header: where it is (branch, author, links) beside who is
 *  signed in to its host; under them, its pull request on the left and the
 *  pill of files viewed and the review's buttons on the right, balanced, the stack it is in, what waits on the reader, then what the
 *  change is for. Each part arrives on its own read. */
export function Header(props: { head: ReviewPageHead }) {
  return (
    <header>
      <div class="header-top">
        <Meta head={props.head} />
        <Viewer />
        <div class="pull-line">
          <Pull />
        </div>
        <HostBar head={props.head} />
      </div>
      <StackRow head={props.head} />
      <DraftsBar />
      <Unplaced />
      <Purpose head={props.head} />
    </header>
  );
}

/** The header before anything is read: its parts' placeholders. */
Header.Skeleton = function Skeleton() {
  return (
    <header>
      <div class="header-top">
        <Meta.Skeleton />
        <Viewer.Skeleton />
        <div class="pull-line">
          <Pull.Skeleton />
        </div>
        <HostBar.Skeleton />
      </div>
      <Purpose.Skeleton />
    </header>
  );
};
