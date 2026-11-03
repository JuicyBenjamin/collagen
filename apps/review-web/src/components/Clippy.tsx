import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Portal } from "@solidjs/web";
import type { initAgent } from "clippyjs";
import { chatNow } from "../chatNow";
import { floating } from "../floating";
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
// He stands where CSS puts him, as the chat's pill does, and his balloon
// above him; clippyjs's own placing (and dragging him, every 10 ms) measures
// and moves him across the page, which on a review of many files costs it a
// long pause each time. His own animation only shifts his sprite.

type Agent = Awaited<ReturnType<typeof initAgent>>;

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
  // where he stands: a wrapper in the corner that CSS places (.clippy), him
  // and his balloon inside it, the balloon above him (.clippy-balloon)
  let home: HTMLDivElement | undefined;
  void (async () => {
    const [{ initAgent: start }, { default: clippy }] = await Promise.all([import("clippyjs"), import("clippyjs/agents/clippy")]);
    if (gone) return;
    const made = await start(clippy);
    if (gone) return made.dispose();
    // a press would start clippyjs dragging him: a click is all he takes
    made._el.removeEventListener("mousedown", made._mouseDownHandle);
    // nor does clippyjs place him and his balloon, measuring as it goes: CSS does
    removeEventListener("resize", made._resizeHandle);
    const balloon = made._balloon._balloon;
    for (const placed of [made._el, balloon]) for (const property of ["position", "top", "left", "z-index"]) placed.style.removeProperty(property);
    balloon.classList.add("clippy-balloon");
    made._balloon._positionTip("top-left");
    home!.append(made._el, balloon);
    made._el.addEventListener("click", () => (chatNow.open() ? chatNow.close() : chatNow.openUp()));
    made._el.title = "Ask Clippy";
    const chat = document.createElement("div");
    chat.className = "clippy-chat";
    made._balloon._balloon.appendChild(chat);
    made.show(true);
    setBox(chat);
    setAgent(made);
  })();
  onCleanup(() => {
    gone = true;
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
    // up out of the way when the review's actions float into the corner, as the chat's pill
    <div class={["clippy", { lifted: floating() }]} ref={(element) => (home = element)}>
      <Show when={box()}>
        {(mount) => (
          <Portal mount={mount()}>
            <Balloon />
          </Portal>
        )}
      </Show>
    </div>
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
