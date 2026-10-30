import type { MergeTicket } from "~/data";

/** A ticket's kind as a mark, coloured by kind: the review page's and the
 *  merges page's one way to say what a ticket is. */
export function KindIcon(props: { kind: MergeTicket["kind"] }) {
  return (
    <svg
      class={["kind-icon", `kind-${props.kind}`]}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      role="img"
      aria-label={props.kind}
    >
      {(() => {
        switch (props.kind) {
          case "proposal":
            return (
              <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" />
            );
          case "plan":
            return <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15" />;
          case "task":
            return <path d="M4 4h16v16H4zM8 12l3 3 5-6" />;
          case "bug":
            return <path d="M4 21V4h12l-2 4 2 4H4" />;
          case "review":
            return (
              <>
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
              </>
            );
          case "investigation":
            return (
              <>
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </>
            );
          case "epic":
            return <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />;
        }
      })()}
    </svg>
  );
}
