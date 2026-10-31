import { createSignal, onCleanup, Show } from "solid-js";
import { settingsNow } from "~/settingsNow";

// How far down the review the reader is: a thin bar fixed atop the page,
// filling as they scroll. It measures the page, not the files viewed (the
// count beside the finish buttons says that). On unless the person switched
// it off (progressBar).

export function ReadingBar() {
  const [read, setRead] = createSignal(0);
  const measure = () => {
    const room = document.documentElement.scrollHeight - window.innerHeight;
    setRead(room > 0 ? Math.min(1, window.scrollY / room) : 0);
  };
  let frame = 0;
  const onScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  measure();
  onCleanup(() => {
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
    cancelAnimationFrame(frame);
  });
  return (
    <Show when={settingsNow.settings().progressBar}>
      <div class="reading-bar" aria-hidden="true" style={{ transform: `scaleX(${read()})` }} />
    </Show>
  );
}
