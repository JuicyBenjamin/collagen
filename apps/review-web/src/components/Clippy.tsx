import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Portal } from "@solidjs/web";
import type { initAgent } from "clippyjs";
import { chatNow } from "../chatNow";
import { selectionLabel, selectionShort } from "../chatText";

// The gag (set-settings clippy, on no settings screen): the ask-AI chat is
// Clippy. He stands in the corner where its pill would; a click on him opens
// the chat in his own yellow balloon — what you last asked and his answer,
// and a box to ask the next thing — as the Office assistant asked "What
// would you like to do?". While the reader's AI answers he thinks, and he
// gestures when it is done. Microsoft's
// own Clippy, through clippyjs, loaded only when he is asked for — his
// sprites come with the page, nothing is fetched from elsewhere.
//
// He moves the page as little as he can: a review page holds a great many
// lines, and anything that changes the layout costs it a long pause. So he
// is not dragged (clippyjs moves a dragged agent every 10 ms), he is put in
// his corner once (and again only when the window is resized), and his
// balloon is placed when it opens and when an answer is done, not as it
// streams — set where he stands, never measured (clippyjs's own placing
// measures the page four times over). His own animation only shifts his
// sprite, which costs nothing.

type Agent = Awaited<ReturnType<typeof initAgent>>;

const EDGE = 18;
/** Between his head and the balloon's tip. */
const ABOVE = 15;

/** An answer as words in his balloon: no code fences, no markdown marks. */
const plain = (answer: string): string =>
  answer
    .replace(/```[\s\S]*?```/g, " (code) ")
    .replace(/[`*_#>[\]]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

export function Clippy() {
  const [agent, setAgent] = createSignal<Agent | null>(null);
  // the chat's own box in his balloon, beside the words he says
  const [box, setBox] = createSignal<HTMLDivElement | null>(null);
  let gone = false;
  // where he stands, kept, so nothing need measure him again
  let stand = { left: 0, top: 0, width: 0 };
  /** in the corner, at once: one change to the page, not a walk across it */
  const corner = (him: Agent | null = agent()) => {
    if (!him) return;
    const { offsetWidth: width, offsetHeight: height } = him._el;
    stand = { left: Math.max(EDGE, innerWidth - EDGE - width), top: Math.max(EDGE, innerHeight - EDGE - height), width };
    him._el.style.left = `${stand.left}px`;
    him._el.style.top = `${stand.top}px`;
    if (chatNow.open()) beside(him);
  };
  /** the balloon over him, its tip at his head: pinned by its right and
   *  bottom edges, so it grows upward with what is in it and is placed once */
  const beside = (him: Agent) => {
    const style = him._balloon._balloon.style;
    style.top = style.left = "auto";
    style.right = `${innerWidth - (stand.left + stand.width)}px`;
    style.bottom = `${innerHeight - stand.top + ABOVE}px`;
    him._balloon._positionTip("top-left");
  };
  const onResize = () => corner();
  void (async () => {
    const [{ initAgent: start }, { default: clippy }] = await Promise.all([import("clippyjs"), import("clippyjs/agents/clippy")]);
    if (gone) return;
    const made = await start(clippy);
    if (gone) return made.dispose();
    // a press would start clippyjs dragging him: a click is all he takes
    made._el.removeEventListener("mousedown", made._mouseDownHandle);
    // nor does clippyjs place him and his balloon on a resize, measuring as it goes: corner() does
    removeEventListener("resize", made._resizeHandle);
    made._el.addEventListener("click", () => (chatNow.open() ? chatNow.close() : chatNow.openUp()));
    made._el.title = "Ask Clippy";
    const chat = document.createElement("div");
    chat.className = "clippy-chat";
    made._balloon._balloon.appendChild(chat);
    made.show(true);
    setBox(chat);
    setAgent(made);
    // the agent as it is made: a signal set is seen only after
    corner(made);
    addEventListener("resize", onResize);
  })();
  onCleanup(() => {
    gone = true;
    removeEventListener("resize", onResize);
    agent()?.dispose();
  });

  // the balloon open as long as the chat is: his own words give way to it,
  // and his timers, which close a balloon once its words are said, are held
  createEffect(
    () => [agent(), chatNow.open()] as const,
    ([him, open]) => {
      if (!him) return;
      const balloon = him._balloon;
      balloon._content.style.display = open ? "none" : "";
      box()!.style.display = open ? "" : "none";
      if (open) {
        balloon.pause();
        balloon._active = true;
        balloon._hidden = false;
        balloon._balloon.style.display = "block";
        beside(him);
        queueMicrotask(() => box()?.querySelector("textarea")?.focus());
      } else {
        balloon._active = false;
        balloon.hide(true);
      }
    },
  );
  // thinking while the reader's own AI answers
  createEffect(
    () => chatNow.answering(),
    (busy) => {
      const him = agent();
      if (!him || !busy) return;
      // stopping him would close the balloon: queued, while it is open
      if (!chatNow.open()) him.stop();
      him.play(him.hasAnimation("Thinking") ? "Thinking" : "Searching");
    },
  );
  // an answer finished in front of him: a gesture
  let last: string | null | undefined;
  createEffect(
    () => {
      const turn = (chatNow.view()?.turns ?? []).filter((each) => each.from === undefined).at(-1);
      return turn && turn.state === "done" && turn.answer ? { id: turn.id, answer: turn.answer } : null;
    },
    (finished) => {
      const first = last === undefined;
      if (last === (finished?.id ?? null)) return;
      last = finished?.id ?? null;
      const him = agent();
      if (first || !finished || !him) return;
      if (!chatNow.open()) him.stop();
      him.play("Explain");
    },
  );

  return (
    <Show when={box()}>
      {(mount) => (
        <Portal mount={mount()}>
          <Balloon />
        </Portal>
      )}
    </Show>
  );
}

/** The chat in his balloon: the last thing asked and his answer to it, then
 *  the box for the next — Enter asks, Esc closes. */
function Balloon() {
  const question = chatNow.draft;
  const latest = () => (chatNow.view()?.turns ?? []).filter((turn) => turn.from === undefined).at(-1);
  const send = async () => {
    if (await chatNow.ask(question())) chatNow.setDraft("");
  };
  return (
    <form
      class="clippy-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!chatNow.answering()) void send();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") chatNow.close();
      }}
    >
      <Show when={latest()}>
        {(turn) => (
          <div class="clippy-said">
            <p>
              <b>{turn().question}</b>
            </p>
            <p class="clippy-answer">{turn().answer ? plain(turn().answer) : turn().state === "answering" ? (turn().doing ?? "Let me see…") : ""}</p>
          </div>
        )}
      </Show>
      <p>
        <b>What would you like to know?</b>
      </p>
      <Show when={chatNow.attached()}>
        {(selection) => (
          <p title={selectionLabel(selection())}>
            About {selectionShort(selection())}{" "}
            <button type="button" class="btn btn-ghost btn-xs" data-theme="light" onClick={() => chatNow.detach()}>
              not these
            </button>
          </p>
        )}
      </Show>
      <textarea
        class="textarea textarea-sm"
        data-theme="light"
        rows={2}
        placeholder="Type your question here"
        value={question()}
        onInput={(event) => chatNow.setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            if (!chatNow.answering()) void send();
          }
        }}
      />
      <Show when={chatNow.refused()}>{(why) => <p>{why()}</p>}</Show>
      <div class="clippy-actions">
        <button type="button" class="btn btn-sm" data-theme="light" onClick={() => chatNow.close()}>
          Close
        </button>
        <Show
          when={chatNow.answering()}
          fallback={
            <button type="submit" class="btn btn-sm" data-theme="light" disabled={chatNow.sending() || question().trim().length === 0}>
              Ask
            </button>
          }
        >
          <button type="button" class="btn btn-sm" data-theme="light" onClick={() => chatNow.stop()}>
            Stop
          </button>
        </Show>
      </div>
    </form>
  );
}
