import type { AuditPage } from "~/data";
import { Donut } from "./Donut";
import { PanelSkeleton } from "./PanelSkeleton";

/** Which models wrote the room's records. */
export function Models(props: { models: AuditPage["models"] }) {
  return (
    <section class="audit-panel">
      <h2>Models</h2>
      <p class="audit-sub">Which model wrote the room's records</p>
      <Donut
        rows={props.models.map((model) => ({ name: model.name, value: model.acts }))}
        unit="records"
        ariaLabel="The room's records by model"
      />
    </section>
  );
}

Models.Skeleton = () => (
  <PanelSkeleton title="Models" sub="Which model wrote the room's records" height={200} />
);
