import { createEffect, createMemo, createSignal, For, Show, type Element } from "solid-js";
import { Appear } from "./Appear";
import { arrive, flyIn, grow, rise, shrink, sink } from "../fold";
import { floating } from "../floating";
import { chatNow } from "../chatNow";
import { overSocket } from "../liveSocket";
import { selectionLabel, selectionShort } from "../chatText";
import { Markdown } from "./Markdown";
import { ago } from "../when";
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
      {/* the pill and the panel turn into each other (chatNow.openUp, close):
          the panel grows out of the pill, and shrinks back onto it, placed
          beneath as it starts to close — its words coming once it is the pill */}
      <InCorner
        when={!chatNow.open() && chatNow.held()}
        enter={(element) => (chatNow.turn.intoPill ? arrive(element.firstElementChild, 0.24) : rise(element))}
        // the panel growing out of it covers it from the first frame
        leave={sink}
        held={(element) => (chatNow.corner.pill = element)}
      >
        {(placed) => (
          <button ref={placed} type="button" class={["chat-pill", { lifted: floating() }]} onClick={() => chatNow.openUp()}>
            <span>{chatNow.answering() ? "AI answering…" : "AI chat"}</span>
          </button>
        )}
      </InCorner>
      <InCorner
        when={chatNow.open()}
        enter={(element) => {
          const { from, flyFrom } = chatNow.turn;
          chatNow.turn.from = chatNow.turn.flyFrom = null;
          // from the pill, from a comment form (chatNow.handOver), or out of its corner
          if (from) grow(element, from);
          else if (flyFrom) flyIn(element, flyFrom);
          else rise(element);
        }}
        leave={async (element) => {
          if (!chatNow.turn.intoPill) return sink(element);
          // the pill is placed as this starts to close: once it is drawn, this closes onto it
          await Promise.resolve();
          const pill = chatNow.corner.pill;
          try {
            await (pill ? shrink(element, pill.getBoundingClientRect()) : sink(element));
          } finally {
            chatNow.turn.intoPill = false;
          }
        }}
        held={(element) => (chatNow.corner.panel = element)}
      >
        {(placed) => <Panel placed={placed} />}
      </InCorner>
    </>
  );
}

/** Something in the window's corner, the chat's pill or its panel: `enter`
 *  brings it in as it is placed, and it stays placed through `leave`, taken
 *  away then only if it was not opened again meanwhile (it rises back).
 *  `held` is told the element while it is placed, and undefined after. */
function InCorner(props: {
  when: boolean;
  enter: (element: HTMLElement) => void;
  leave: (element: HTMLElement) => Promise<void>;
  held: (element: HTMLElement | undefined) => void;
  children: (placed: (element: HTMLElement) => void) => Element;
}) {
  const [placed, setPlaced] = createSignal(props.when);
  let element: HTMLElement | undefined;
  let sinking = false;
  const gone = () => {
    sinking = false;
    element = undefined;
    props.held(undefined);
    setPlaced(false);
  };
  createEffect(
    () => props.when,
    (when) => {
      if (when) {
        if (sinking && element) rise(element);
        sinking = false;
        return void setPlaced(true);
      }
      if (!element) return gone();
      sinking = true;
      void props.leave(element).then(() => {
        if (sinking) gone();
      });
    },
  );
  return (
    <Show when={placed()}>
      {props.children((placedElement) => {
        element = placedElement;
        props.held(placedElement);
        props.enter(placedElement);
      })}
    </Show>
  );
}

function Panel(props: { placed: (element: HTMLElement) => void }) {
  const question = chatNow.draft;
  const setQuestion = chatNow.setDraft;
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
    <aside
      // above the review's pill once it floats in the corner
      class={["chat-panel", { lifted: floating() }]}
      aria-label="Chat with your AI"
      ref={props.placed}
    >
      <div class="chat-head">
        <span class="chat-ai">{chatNow.view()?.ai ?? "Your AI"}</span>
        {/* a new chat keeps the one before: back to any of them */}
        <Show when={(chatNow.view()?.earlier.length ?? 0) > 0}>
          <select
            class="select select-ghost select-xs"
            aria-label="Earlier chats"
            value=""
            onChange={(event) => {
              const chatId = event.currentTarget.value;
              event.currentTarget.value = "";
              if (chatId) chatNow.reopen(chatId);
            }}
          >
            <option value="" disabled>
              Earlier chats ({chatNow.view()?.earlier.length})
            </option>
            <For each={chatNow.view()?.earlier ?? []}>
              {(earlier) => (
                <option value={earlier.id}>
                  {earlier.first ? (earlier.first.length > 48 ? `${earlier.first.slice(0, 47)}…` : earlier.first) : `${earlier.questions} questions`}
                  {earlier.ended ? ` · ${ago(Date.parse(earlier.ended), Date.now())}` : ""}
                </option>
              )}
            </For>
          </select>
        </Show>
        <Show when={(chatNow.view()?.turns.length ?? 0) > 0}>
          <button type="button" class="btn btn-ghost btn-xs" onClick={() => chatNow.restart()} title="Start a new conversation — this one stays under Earlier chats">
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
              <span class="chat-attached badge badge-sm badge-soft badge-primary" title={selectionLabel(selection())}>
                {selectionShort(selection())}
                <button type="button" class="btn btn-ghost btn-xs btn-circle" aria-label="Don't ask about these lines" onClick={() => chatNow.detach()}>
                  ×
                </button>
              </span>
            )}
          </Show>
          <textarea
            class="textarea"
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
                <button type="submit" class="btn btn-primary btn-sm" disabled={chatNow.sending() || question().trim().length === 0}>
                  Ask
                </button>
              }
            >
              <button type="button" class="btn btn-sm" onClick={() => chatNow.stop()}>
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
  // the person's own review ("you"): the conversation of theirs that did the work answers
  const author = () => chatNow.view()?.author ?? "the author";
  const whose = (name: string) => (name === "you" ? "the conversation that did the work" : `${name}'s AI`);
  /** who answers: the reader's own AI, or the review's author's */
  const answerer = () => (props.turn.from === undefined ? (chatNow.view()?.ai ?? "Your AI") : props.turn.from === "you" ? "The conversation that did the work" : `${props.turn.from}'s AI`);
  return (
    <div class="chat-turn">
      {/* an author's AI answers under the question it was asked: no question of its own */}
      <Show when={props.turn.from === undefined}>
        <div class="chat chat-end">
          <Show when={props.turn.selection}>
            {(selection) => (
              <div class="chat-header">
                <span class="badge badge-sm badge-soft badge-primary" title={selectionLabel(selection())}>
                  {selectionShort(selection())}
                </span>
              </div>
            )}
          </Show>
          <div class="chat-bubble chat-bubble-primary chat-q">
            <p>{props.turn.question}</p>
          </div>
        </div>
      </Show>
      <div class="chat chat-start">
        <div class="chat-header">{answerer()}</div>
        <div class="chat-bubble">
          {/* as the page reads any comment: markdown, never set as HTML */}
          <Show when={props.turn.answer}>
            <Markdown text={props.turn.answer} />
          </Show>
          {/* nothing said yet: it is thinking */}
          <Show when={props.turn.state === "answering" && !props.turn.answer}>
            <span class="loading loading-dots loading-sm" aria-label="Thinking" />
          </Show>
        </div>
        <Show when={(props.turn.state === "answering" && props.turn.doing) || props.turn.state === "stopped" || props.turn.state === "failed"}>
          <div class="chat-footer">
            <Show when={props.turn.state === "answering"}>
              <span class="chat-doing">{props.turn.doing}</span>
            </Show>
            <Show when={props.turn.state === "stopped"}>
              <span class="chat-doing">Stopped</span>
            </Show>
            <Show when={props.turn.state === "failed"}>
              <span class="host-error">{props.turn.error ?? "Failed"}</span>
            </Show>
          </div>
        </Show>
      </div>
      {/* the author cannot answer for now: the reader's own AI, instead of a guess passed off as theirs */}
      <Show when={props.turn.fallback && props.turn.from}>
        <div class="chat-fallback">
          <button type="button" class="btn btn-xs" disabled={chatNow.answering()} onClick={() => void chatNow.instead(props.turn.id, "assume")} title="Your AI's best reading of why, sent to their review's why as a guess for them to settle">
            Assume the reason
          </button>
          <button type="button" class="btn btn-xs" disabled={chatNow.answering()} onClick={() => void chatNow.instead(props.turn.id, "critique")} title="The same guess, then whether it is good enough: what it asks to change becomes your draft comments">
            Critique it
          </button>
        </div>
      </Show>
      <Show when={props.turn.forward}>
        {(forward) => (
          <div class="chat-fallback">
            <Show
              when={forward().state === "offered"}
              fallback={
                <Show when={forward().state === "asked"}>
                  <span class="chat-doing">Asked {whose(author())}</span>
                </Show>
              }
            >
              <button type="button" class="btn btn-primary btn-xs" onClick={() => void chatNow.forward(props.turn.id)} title={forward().question}>
                Ask {whose(author())}
              </button>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
