import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Appear } from "./Appear";
import { chatNow } from "../chatNow";
import { overSocket } from "../liveSocket";
import { answerParts, selectionLabel } from "../chatText";
import type { ChatTurn } from "../data";
import { lasting } from "../lasting";
import { ticketId } from "../ticket";

/** The reader's conversation with their own AI on this review: an offer to
 *  ask under code they select, and a panel in the corner — their questions,
 *  each with the lines it was about, and the answers streaming in as their
 *  AI writes them. Held by their collagen, so another tab on the review, or
 *  this one reloaded, shows the same conversation. */
export function Chat() {
  // the conversation, live from the instance while the page is open
  const live = createMemo(() => lasting(() => overSocket("chat", ticketId)));
  createEffect(live, (view) => {
    chatNow.setView(view);
  });
  chatNow.watch();
  const turns = () => chatNow.view()?.turns ?? [];
  return (
    <>
      <Appear when={chatNow.offer()}>
        {(offer) => (
          <button
            type="button"
            class="ask-offer"
            style={{ left: `${offer().x}px`, top: `${offer().y + 6}px` }}
            // the selection must outlive the press: it is what is asked about
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => chatNow.take()}
            title={`Ask your AI about ${selectionLabel(offer().selection)}`}
          >
            Ask AI
          </button>
        )}
      </Appear>
      <Appear when={!chatNow.open() && turns().length > 0}>
        {() => (
          <button type="button" class="chat-pill" onClick={() => chatNow.toggle()}>
            {chatNow.answering() ? "AI answering…" : "AI chat"}
          </button>
        )}
      </Appear>
      <Appear when={chatNow.open()}>{() => <Panel />}</Appear>
    </>
  );
}

function Panel() {
  const [question, setQuestion] = createSignal("");
  let log: HTMLDivElement | undefined;
  let input: HTMLTextAreaElement | undefined;
  // follows the answer down as it grows — unless the reader scrolled up to read
  let following = true;
  createEffect(
    () => chatNow.view(),
    () => {
      if (log && following) log.scrollTop = log.scrollHeight;
    },
  );
  // lines picked to ask about: the question is next
  createEffect(chatNow.asking, () => {
    queueMicrotask(() => input?.focus());
  });
  const send = async () => {
    if (await chatNow.ask(question())) {
      setQuestion("");
      following = true;
    }
  };
  const cannot = () => chatNow.view()?.cannot ?? null;
  return (
    <aside class="chat" aria-label="Chat with your AI">
      <div class="chat-head">
        <span class="chat-ai">{chatNow.view()?.ai ?? "Your AI"}</span>
        <Show when={(chatNow.view()?.turns.length ?? 0) > 0}>
          <button type="button" class="quiet small" onClick={() => chatNow.restart()} title="Start the conversation over">
            New chat
          </button>
        </Show>
        <button type="button" class="banner-close" aria-label="Close" onClick={() => chatNow.close()}>
          ×
        </button>
      </div>
      <div
        class="chat-log"
        ref={(element) => (log = element)}
        onScroll={(event) => {
          const element = event.currentTarget;
          following = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
        }}
      >
        <For each={chatNow.view()?.turns ?? []} fallback={<Show when={!chatNow.attached()}><p class="chat-empty">Select code to ask about it.</p></Show>}>
          {(turn) => <Turn turn={turn} />}
        </For>
      </div>
      <Show
        when={!cannot()}
        fallback={<p class="chat-cannot">{cannot()}</p>}
      >
        <form
          class="chat-ask"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Show when={chatNow.attached()}>
            {(selection) => (
              <span class="chat-attached">
                <code>{selectionLabel(selection())}</code>
                <button type="button" class="chat-detach" aria-label="Don't ask about these lines" onClick={() => chatNow.detach()}>
                  ×
                </button>
              </span>
            )}
          </Show>
          <textarea
            ref={(element) => (input = element)}
            rows={2}
            placeholder={chatNow.attached() ? "Ask about these lines" : "Ask about this review"}
            value={question()}
            onInput={(event) => setQuestion(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                if (!chatNow.answering()) void send();
              }
            }}
          />
          <Show when={chatNow.refused()}>{(why) => <p class="host-error">{why()}</p>}</Show>
          <div class="composer-actions">
            <Show
              when={chatNow.answering()}
              fallback={
                <button type="submit" class="banner-go" disabled={chatNow.sending() || question().trim().length === 0}>
                  Ask
                </button>
              }
            >
              <button type="button" class="quiet" onClick={() => chatNow.stop()}>
                Stop
              </button>
            </Show>
          </div>
        </form>
      </Show>
    </aside>
  );
}

function Turn(props: { turn: ChatTurn }) {
  const parts = createMemo(() => answerParts(props.turn.answer));
  return (
    <div class="chat-turn">
      <div class="chat-q">
        <Show when={props.turn.selection}>{(selection) => <code class="chat-about">{selectionLabel(selection())}</code>}</Show>
        <p>{props.turn.question}</p>
      </div>
      <div class={["chat-a", { failed: props.turn.state === "failed" }]}>
        <For each={parts()}>
          {(part) => (
            <Show when={part.kind === "code"} fallback={<p>{part.text}</p>}>
              <pre>
                <code>{part.text}</code>
              </pre>
            </Show>
          )}
        </For>
        <Show when={props.turn.state === "answering"}>
          <p class="chat-doing">{props.turn.doing ?? (props.turn.answer ? "" : "Thinking…")}</p>
        </Show>
        <Show when={props.turn.state === "stopped"}>
          <p class="chat-doing">Stopped</p>
        </Show>
        <Show when={props.turn.state === "failed"}>
          <p class="host-error">{props.turn.error ?? "Failed"}</p>
        </Show>
      </div>
    </div>
  );
}
