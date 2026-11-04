import { createSignal, For, Show } from "solid-js";
import type { Hunk as HunkData, MigrationFile } from "~/data";
import { Appear } from "~/components/Appear";
import { Lines } from "~/components/Page/components/Diff/components/Hunk";

// The migrations tab: each migration as what it does to the schema — tables
// made or dropped, columns added, dropped, changed or renamed, indexes —
// what loses data marked, and one edited after it was written said so, for
// it may have run already. Its lines are one click away.

export function Migrations(props: { files: ReadonlyArray<MigrationFile>; hunks: ReadonlyMap<string, HunkData> }) {
  return <For each={props.files}>{(file) => <Migration file={file} hunks={props.hunks} />}</For>;
}

function Migration(props: { file: MigrationFile; hunks: ReadonlyMap<string, HunkData> }) {
  const lines = () => props.file.hunks.map((id) => props.hunks.get(id)).filter((hunk): hunk is HunkData => hunk !== undefined);
  const [open, setOpen] = createSignal(props.file.changes === null);
  return (
    <section class="tests-file" id={`migration-${props.file.file}`}>
      <h2 class="tests-file-name">
        <code>{props.file.file}</code>
      </h2>
      <Show when={props.file.edited}>
        <div role="status" class="alert alert-soft alert-warning">
          <span>This migration existed before and was edited: it may have run somewhere already.</span>
        </div>
      </Show>
      <Show when={props.file.changes} fallback={<p class="tests-describe">Not read as schema changes: its changes below.</p>}>
        {(changes) => (
          <Show when={changes().length > 0} fallback={<p class="tests-describe">No change to the schema read in it.</p>}>
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>Change</th>
                  <th>Table</th>
                  <th>Column or index</th>
                  <th>Detail</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <For each={changes()}>
                  {(change) => (
                    <tr>
                      <td>{change.action}</td>
                      <td>
                        <code>{change.table}</code>
                      </td>
                      <td>{change.target ? <code>{change.target}</code> : null}</td>
                      <td>{change.detail}</td>
                      <td>{change.losesData ? <span class="badge badge-soft badge-error badge-sm">loses data</span> : null}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        )}
      </Show>
      <label class="test-code-toggle">
        <input type="checkbox" class="checkbox checkbox-primary checkbox-xs" checked={open()} onChange={() => setOpen(!open())} />
        Code · {lines().length === 1 ? "1 change" : `${lines().length} changes`}
      </label>
      <Appear when={open()}>
        {() => (
          <div class="hunk-group test-code">
            <For each={lines()}>
              {(hunk) => (
                <div class="code">
                  <Lines hunk={hunk} threads="all" talk />
                </div>
              )}
            </For>
          </div>
        )}
      </Appear>
    </section>
  );
}
