import { For } from "solid-js";
import { Appear } from "~/components/Appear";
import { hostNow } from "~/hostNow";
import { Comment, Draft, Pending } from "../LineThread";
import { Composer } from "./components/Composer";

/** No line under a comment on the whole file: nothing for a suggestion to replace. */
const noCode = () => null;

/** What is said about a file itself, at its top: the comments on it, those
 *  pending in the reader's review, the drafts their AI left on it, and one
 *  being written when the reader asked for it from the file's header. */
export function FileThread(props: { file: string; writing: boolean; onClose: () => void }) {
  const said = () => hostNow.commentsOn(props.file);
  const inReview = () => hostNow.pendingOn(props.file);
  const drafted = () => hostNow.draftsOn(props.file);
  return (
    <Appear when={said().length > 0 || inReview().length > 0 || drafted().length > 0 || props.writing}>
      {() => (
        <div class="thread file-thread">
          <For each={said()}>{(comment) => <Comment comment={comment} codeOf={noCode} />}</For>
          <For each={inReview()}>{(pending) => <Pending comment={pending} codeOf={noCode} />}</For>
          <For each={drafted()}>{(draft) => <Draft draft={draft} codeOf={noCode} />}</For>
          <Appear when={props.writing}>{() => <Composer file={props.file} onClose={props.onClose} />}</Appear>
        </div>
      )}
    </Appear>
  );
}
