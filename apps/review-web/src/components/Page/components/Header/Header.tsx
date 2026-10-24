import { Show } from "solid-js";
import type { ReviewPageHead } from "~/data";
import { Corner } from "~/components/Corner";
import { DraftsBar } from "./components/DraftsBar";
import { HostBar } from "./components/HostBar";
import { Pull } from "./components/HostBar/components/Pull";
import { Viewer } from "./components/HostBar/components/Viewer";
import { MergeFor } from "./components/MergeFor";
import { Meta } from "./components/Meta";
import { Purpose } from "./components/Purpose";
import { StackRow } from "./components/StackRow";
import { Unplaced } from "./components/Unplaced";

/** The review's header: where it is (branch, author, links) beside the
 *  page's theme and who is signed in to its host; under them, its pull request on the left (on the reader's own, whether collagen merges it) and the
 *  pill of files viewed and the review's buttons on the right, balanced, the stack it is in, what waits on the reader, then what the
 *  change is for. Each part arrives on its own read. */
export function Header(props: { head: ReviewPageHead }) {
  return (
    <header>
      <div class="header-top">
        <Meta head={props.head} />
        <Corner>
          <Viewer />
        </Corner>
        <div class="pull-line">
          <Pull />
          <Show when={props.head.ticket.mine}>
            <MergeFor />
          </Show>
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
        <Corner>
          <Viewer.Skeleton />
        </Corner>
        <div class="pull-line">
          <Pull.Skeleton />
        </div>
        <HostBar.Skeleton />
      </div>
      <Purpose.Skeleton />
    </header>
  );
};
