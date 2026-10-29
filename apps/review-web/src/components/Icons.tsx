import type { Element } from "solid-js";

// The page's icons, drawn in the button's own colour (Lucide's shapes, ISC).
// One set for every button, never a text glyph standing in for one.

const Icon = (props: { children: Element; size?: number }) => (
  <svg class="icon" viewBox="0 0 24 24" width={props.size ?? 18} height={props.size ?? 18} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {props.children}
  </svg>
);

export const ThumbsUp = () => (
  <Icon>
    <path d="M7 10v12" />
    <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
  </Icon>
);

export const ArrowRound = () => (
  <Icon>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </Icon>
);

export const CommentBox = () => (
  <Icon>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Icon>
);

export const Check = () => (
  <Icon>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

/** Ask again: a refresh. */
export const Refresh = (props: { size?: number }) => (
  <Icon size={props.size}>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </Icon>
);
