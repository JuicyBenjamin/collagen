import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Portal } from "@solidjs/web";
import type { initAgent } from "clippyjs";
import { chatNow } from "../chatNow";
import { floating } from "../floating";
import { selectionLabel, selectionShort } from "../chatText";
import type { AssistantId } from "../data";

// The gag (set-settings assistant, on no settings screen): the ask-AI chat
// is an Office assistant — Clippy, or one of his friends clippyjs draws. It
// stands in the corner where the chat's pill would; a click on it opens the
// chat in its own yellow balloon — what you last asked and its answer, and a
// box to ask the next thing — as the Office assistant asked "What would you
// like to do?". While the reader's AI answers it thinks, and it gestures when
// it is done. Microsoft's own, through clippyjs, each loaded only when it is
// asked for — its sprites come with the page, nothing is fetched from
// elsewhere.
//
// It stands where CSS puts it, as the chat's pill does, and its balloon above
// it; clippyjs's own placing (and dragging it, every 10 ms) measures and
// moves it across the page, which on a review of many files costs it a long
// pause each time. Its own animation only shifts its sprite.

type Agent = Awaited<ReturnType<typeof initAgent>>;

/** Each assistant's sprites and moves, each its own chunk of the page, loaded only when chosen. */
const AGENTS: Record<AssistantId, () => Promise<{ default: Parameters<typeof initAgent>[0] }>> = {
  clippy: () => import("clippyjs/agents/clippy"),
  bonzi: () => import("clippyjs/agents/bonzi"),
  f1: () => import("clippyjs/agents/f1"),
  genie: () => import("clippyjs/agents/genie"),
  genius: () => import("clippyjs/agents/genius"),
  links: () => import("clippyjs/agents/links"),
  merlin: () => import("clippyjs/agents/merlin"),
  peedy: () => import("clippyjs/agents/peedy"),
  rocky: () => import("clippyjs/agents/rocky"),
  rover: () => import("clippyjs/agents/rover"),
};

/** An answer as words in its balloon: no code fences, no markdown marks. */
const plain = (answer: string): string =>
  answer
    .replace(/```[\s\S]*?```/g, " (code) ")
    .replace(/[`*_#>[\]]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

export function Assistant(props: { id: AssistantId; name: string }) {
  const [agent, setAgent] = createSignal<Agent | null>(null);
  // the chat's own box in its balloon, beside the words it says
  const [box, setBox] = createSignal<HTMLDivElement | null>(null);
  let gone = false;
  // where it stands: a wrapper in the corner that CSS places (.assistant),
  // it and its balloon inside, the balloon above it (.assistant-balloon)
  let home: HTMLDivElement | undefined;
  void (async () => {
    const [{ initAgent: start }, { default: drawn }] = await Promise.all([import("clippyjs"), AGENTS[props.id]()]);
    if (gone) return;
    const made = await start(drawn);
    if (gone) return made.dispose();
    // a press would start clippyjs dragging it: a click is all it takes
    made._el.removeEventListener("mousedown", made._mouseDownHandle);
    // nor does clippyjs place it and its balloon, measuring as it goes: CSS does
    removeEventListener("resize", made._resizeHandle);
    const balloon = made._balloon._balloon;
    for (const placed of [made._el, balloon]) for (const property of ["position", "top", "left", "z-index"]) placed.style.removeProperty(property);
    balloon.classList.add("assistant-balloon");
    made._balloon._positionTip("top-left");
    home!.append(made._el, balloon);
    made._el.addEventListener("click", () => (chatNow.open() ? chatNow.close() : chatNow.openUp()));
    made._el.title = `Ask ${props.name}`;
    const chat = document.createElement("div");
    chat.className = "assistant-chat";
    made._balloon._balloon.appendChild(chat);
    made.show(true);
    setBox(chat);
    setAgent(made);
  })();
  onCleanup(() => {
    gone = true;
    agent()?.dispose();
  });

  // the balloon open as long as the chat is: its own words give way to it,
  // and its timers, which close a balloon once its words are said, are held
  createEffect(
    () => [agent(), chatNow.open()] as const,
    ([made, open]) => {
      if (!made) return;
      const balloon = made._balloon;
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
      const agentNow = agent();
      if (!agentNow || !busy) return;
      // stopping it would close the balloon: queued, while it is open
      if (!chatNow.open()) agentNow.stop();
      agentNow.play(agentNow.hasAnimation("Thinking") ? "Thinking" : "Searching");
    },
  );
  // an answer finished in front of it: a gesture
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
      const agentNow = agent();
      if (first || !finished || !agentNow) return;
      if (!chatNow.open()) agentNow.stop();
      agentNow.play("Explain");
    },
  );

  return (
    // up out of the way when the review's actions float into the corner, as the chat's pill
    <div class={["assistant", { lifted: floating() }]} ref={(element) => (home = element)}>
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

/** The chat in its balloon: the last thing asked and its answer to it, then
 *  the box for the next — Enter asks, Esc closes. */
function Balloon() {
  const question = chatNow.draft;
  const latest = () => (chatNow.view()?.turns ?? []).filter((turn) => turn.from === undefined).at(-1);
  const send = async () => {
    if (await chatNow.ask(question())) chatNow.setDraft("");
  };
  return (
    <form
      class="assistant-form"
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
          <div class="assistant-said">
            <p>
              <b>{turn().question}</b>
            </p>
            <p class="assistant-answer">{turn().answer ? plain(turn().answer) : turn().state === "answering" ? (turn().doing ?? "Let me see…") : ""}</p>
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
      <div class="assistant-actions">
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
