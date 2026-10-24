import type { Element } from "solid-js";
import { ThemePicker } from "./components/ThemePicker";

/** A page's top right corner, the same on every page: the theme switch,
 *  then whatever the page keeps beside it (the review's, who is signed in). */
export function Corner(props: { children?: Element }) {
  return (
    <div class="header-corner">
      <ThemePicker />
      {props.children}
    </div>
  );
}
