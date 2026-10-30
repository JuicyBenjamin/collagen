import { For } from "solid-js";

/** Two things side by side, as a product page compares them: what one has
 *  and the other does not first, what both have last; a tick or a cross. */
export function Compare(props: { left: string; right: string; rows: ReadonlyArray<{ readonly what: string; readonly left: boolean; readonly right: boolean }> }) {
  const ordered = () => [...props.rows.filter((row) => row.left !== row.right), ...props.rows.filter((row) => row.left === row.right)];
  const Mark = (mark: { has: boolean }) =>
    mark.has ? (
      <svg class="inv-has" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="yes">
        <path d="M5 12.5 10 17.5 19 7" />
      </svg>
    ) : (
      <svg class="inv-lacks" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="no">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    );
  return (
    <table class="inv-compare">
      <thead>
        <tr>
          <th />
          <th scope="col">{props.left}</th>
          <th scope="col">{props.right}</th>
        </tr>
      </thead>
      <tbody>
        <For each={ordered()}>
          {(row) => (
            <tr>
              <th scope="row">{row.what}</th>
              <td>
                <Mark has={row.left} />
              </td>
              <td>
                <Mark has={row.right} />
              </td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}
