import { createEffect, onCleanup } from "solid-js";
import type { initAgent } from "clippyjs";
import { chatNow } from "../chatNow";

// The gag (set-settings clippy, on no settings screen): the ask-AI chat is
// Clippy. He stands in the corner where its pill would; a click on him opens
// the chat, and he steps aside of it while it is open. While the reader's AI
// answers he thinks; once it has, he says the start of its answer. Microsoft's
// own Clippy, through clippyjs, loaded only when he is asked for — his
// sprites come with the page, nothing is fetched from elsewhere.

type Agent = Awaited<ReturnType<typeof initAgent>>;

/** How much of an answer he says: a balloon, not the whole reply. */
const SAYS = 160;
/** From the window's edges, as the pill and the panel stand. */
const EDGE = 18;
const PANEL = 440;

/** An answer as words he can say: no code, no markdown marks. */
const spoken = (answer: string): string => {
  const words = answer.replace(/```[\s\S]*?```/g, " ").replace(/[`*_#>[\]]/g, "").replace(/\s+/g, " ").trim();
  return words.length > SAYS ? `${words.slice(0, SAYS - 1).trimEnd()}…` : words;
};

export function Clippy() {
  let agent: Agent | undefined;
  let gone = false;
  /** where he stands: in the corner, or left of the open chat */
  const place = (open: boolean) => {
    if (!agent) return;
    const { offsetWidth: width, offsetHeight: height } = agent._el;
    const beside = open ? Math.min(PANEL, innerWidth - 2 * EDGE) + 12 : 0;
    agent.moveTo(Math.max(EDGE, innerWidth - EDGE - beside - width), innerHeight - EDGE - height, 600);
  };
  void (async () => {
    const [{ initAgent: start }, { default: clippy }] = await Promise.all([import("clippyjs"), import("clippyjs/agents/clippy")]);
    if (gone) return;
    const made = await start(clippy);
    if (gone) return made.dispose();
    agent = made;
    agent._el.addEventListener("click", () => (chatNow.open() ? chatNow.close() : chatNow.openUp()));
    agent._el.title = "Ask Clippy";
    agent.show(false);
    place(chatNow.open());
  })();
  onCleanup(() => {
    gone = true;
    agent?.dispose();
  });

  createEffect(
    () => chatNow.open(),
    (open) => place(open),
  );
  // thinking while the reader's own AI answers
  createEffect(
    () => chatNow.answering(),
    (busy) => {
      if (!agent || !busy) return;
      agent.stop();
      agent.play(agent.hasAnimation("Thinking") ? "Thinking" : "Searching");
    },
  );
  // an answer the reader's AI finished while he was here: he says it. Not
  // the ones there already when he came — only what happens in front of him.
  let said: string | null | undefined;
  createEffect(
    () => {
      const last = (chatNow.view()?.turns ?? []).filter((turn) => turn.from === undefined).at(-1);
      return last && last.state === "done" && last.answer ? { id: last.id, answer: last.answer } : null;
    },
    (finished) => {
      const first = said === undefined;
      if (said === (finished?.id ?? null)) return;
      said = finished?.id ?? null;
      if (first || !finished || !agent) return;
      // the words the moment the answer is in: speak() would queue them
      // behind his thinking, whose way out takes seconds; the gesture after
      agent.stop();
      agent._balloon.speak(() => undefined, spoken(finished.answer), false);
      agent.play("Explain");
    },
  );
  return null;
}
