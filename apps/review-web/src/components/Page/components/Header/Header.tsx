import type { ReviewPageHead } from "~/data";
import { DraftsBar } from "./components/DraftsBar";
import { HostBar } from "./components/HostBar";
import { Meta } from "./components/Meta";
import { Purpose } from "./components/Purpose";
import { StackRow } from "./components/StackRow";
import { Unplaced } from "./components/Unplaced";

/** The review's header: where it is (branch, author, links) beside the
 *  host's bar, the stack it is in, what waits on the reader, then what the
 *  change is for. Each part arrives on its own read. */
export function Header(props: { head: ReviewPageHead }) {
  return (
    <header>
      <div class="header-top">
        <Meta head={props.head} />
        <HostBar />
      </div>
      <StackRow />
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
        <HostBar.Skeleton />
      </div>
      <Purpose.Skeleton />
    </header>
  );
};
