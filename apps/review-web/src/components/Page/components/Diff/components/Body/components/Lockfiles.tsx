import { createSignal, For, Show } from "solid-js";
import type { Hunk as HunkData, LockFile } from "~/data";
import { Appear } from "~/components/Appear";
import { Lines } from "~/components/Page/components/Diff/components/Hunk";

// The lockfiles tab: each lockfile as the packages its change moves —
// added, removed, or from one version to another — so the reader asks only
// whether that followed from the change. Its lines are one click away; a
// lockfile collagen does not read as packages shows its lines alone.

/** A package's versions on one side, or a dash where it was not there. */
const versions = (side: ReadonlyArray<string>) => (side.length === 0 ? "—" : side.join(", "));

/** How the change moves a package, as a badge. */
const moved = (change: { readonly before: ReadonlyArray<string>; readonly after: ReadonlyArray<string> }) =>
  change.before.length === 0 ? { text: "added", class: "badge-success" } : change.after.length === 0 ? { text: "removed", class: "badge-error" } : { text: "updated", class: "badge-info" };

export function Lockfiles(props: { files: ReadonlyArray<LockFile>; hunks: ReadonlyMap<string, HunkData> }) {
  return <For each={props.files}>{(file) => <Lockfile file={file} hunks={props.hunks} />}</For>;
}

function Lockfile(props: { file: LockFile; hunks: ReadonlyMap<string, HunkData> }) {
  const lines = () => props.file.hunks.map((id) => props.hunks.get(id)).filter((hunk): hunk is HunkData => hunk !== undefined);
  // a lockfile not read as packages has nothing but its lines: open at once
  const [open, setOpen] = createSignal(props.file.packages === null);
  return (
    <section class="tests-file" id={`lockfile-${props.file.file}`}>
      <h2 class="tests-file-name">
        <code>{props.file.file}</code>
      </h2>
      <Show
        when={props.file.packages}
        fallback={<p class="tests-describe">Not read as packages: its changes below.</p>}
      >
        {(packages) => (
          <Show when={packages().length > 0} fallback={<p class="tests-describe">No package moved: only how they are recorded changed.</p>}>
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Before</th>
                  <th>After</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <For each={packages()}>
                  {(change) => (
                    <tr>
                      <td>
                        <code>{change.name}</code>
                      </td>
                      <td>{versions(change.before)}</td>
                      <td>{versions(change.after)}</td>
                      <td>
                        <span class={["badge badge-soft badge-sm", moved(change).class]}>{moved(change).text}</span>
                      </td>
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
