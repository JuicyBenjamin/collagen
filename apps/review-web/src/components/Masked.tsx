import type { Element } from "solid-js";

/** Words in a placeholder: a bar their size where they will be
 *  (styles.css: .sk-w). A placeholder is a part's own markup with its words
 *  masked, so it is the size of what replaces it. */
export function Masked(props: { children: Element }) {
  return <span class="sk-w">{props.children}</span>;
}
