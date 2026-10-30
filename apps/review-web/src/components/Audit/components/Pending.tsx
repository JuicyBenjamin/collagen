import { Masked } from "~/components/Masked";

/** Words not known yet: a bar their size, breathing, where they will be. */
export function Pending(props: { children: string }) {
  return (
    <span class="sk">
      <Masked>{props.children}</Masked>
    </span>
  );
}
