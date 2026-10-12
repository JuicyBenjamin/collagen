import { Effect, Stream } from "effect";
import { Atom } from "effect/reactivity";
import type { Project } from "@collagen/p2p";
import { defaultBranchOf, repoWebUrl } from "../../../lib/gitInfo";
import { openInBrowser } from "../../../lib/opener";
import { hostOf, type HostMerge } from "../../../services/RepoHost";
import { Rooms } from "../../../services/Rooms";
import { StateStore } from "../../../services/StateStore";
import { runtimeAtom } from "../../../app/runtime";

/** What was merged into one of your projects' default branch, the latest
 *  first, as its host says — or why that cannot be read. */
export type ProjectMerges = { readonly project: string } & (
  | { readonly repo: string; readonly base: string; readonly merges: ReadonlyArray<HostMerge> }
  | { readonly none: string }
);

const mergesOf = (p: Project): Effect.Effect<ProjectMerges> =>
  Effect.gen(function* () {
    const repo = repoWebUrl(p.path);
    if (!repo) return { project: p.name, none: "no remote" };
    const host = hostOf(repo);
    if (!host) return { project: p.name, none: "host not supported" };
    const base = defaultBranchOf(p.path);
    if (!base) return { project: p.name, none: "no default branch" };
    return yield* host.merges(repo, base).pipe(
      Effect.map((merges): ProjectMerges => ({ project: p.name, repo, base, merges })),
      Effect.catchTags({
        HostCliMissing: () => Effect.succeed({ project: p.name, none: "install gh and run gh auth login" }),
        HostRefused: (e) => Effect.succeed({ project: p.name, none: e.reason }),
      }),
    );
  });

/** The focused room's projects held here, each with its merges: read from
 *  the host when the tab opens, the room changes, or the reader asks again
 *  — merges are not pushed to us, and a read is a few calls to the host.
 *  null while a room's are being read, so another room's are never shown
 *  under this one. */
export const mergesAtom = runtimeAtom.atom(
  Stream.unwrap(Effect.gen(function* () {
    const rooms = yield* Rooms;
    const store = yield* StateStore;
    return rooms.watch((h) =>
      Stream.concat(
        Stream.succeed(null),
        Stream.fromEffect(
          Effect.gen(function* () {
            const projects = [...((yield* store.get).rooms[h.id] ?? [])].sort((a, b) => a.name.localeCompare(b.name));
            return yield* Effect.forEach(projects, mergesOf, { concurrency: 4 });
          }),
        ),
      ),
    );
  })),
);

/** The row the cursor is on, by what it is — kept while the reader opens a
 *  ticket and comes back, and when a read brings new merges in above it. */
export const mergesCursorAtom = Atom.keepAlive(Atom.make<string | null>(null));

/** o on a merge: its pull request in the person's browser. What happened
 *  goes to the activity log, url included, for a machine with no browser. */
export const openLinkAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ url }: { url: string }) {
    const ok = yield* openInBrowser(url);
    yield* Effect.log(ok ? `opened: ${url}` : `${url} (could not open a browser — paste it into one)`);
  }),
);
