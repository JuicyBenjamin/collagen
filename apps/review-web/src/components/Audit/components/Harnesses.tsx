import type { AuditPage } from "~/data";
import { Donut } from "./Donut";
import { PanelSkeleton } from "./PanelSkeleton";

/** Which harnesses wrote the room's records. */
export function Harnesses(props: { harnesses: AuditPage["harnesses"] }) {
  return (
    <section class="audit-panel">
      <h2>Harnesses</h2>
      <p class="audit-sub">Who wrote the room's records</p>
      <Donut
        rows={props.harnesses.map((harness) => ({ name: harness.name, value: harness.acts }))}
        unit="records"
        ariaLabel="The room's records by harness"
      />
    </section>
  );
}

Harnesses.Skeleton = () => (
  <PanelSkeleton title="Harnesses" sub="Who wrote the room's records" height={200} />
);
