import { viewed } from "~/viewedNow";

/** The count and its bar. */
export function Count() {
  const progress = () => viewed.count();
  return (
    <span
      class={["viewed-progress", { done: progress().viewed === progress().files }]}
      title="Files you have marked as viewed"
    >
      <span class="bar" aria-hidden="true">
        <span style={{ width: `${(100 * progress().viewed) / progress().files}%` }} />
      </span>
      {progress().viewed} / {progress().files} files viewed
    </span>
  );
}
