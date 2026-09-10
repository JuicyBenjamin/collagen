import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Context, Data, Duration, Effect, Layer, Schedule, SubscriptionRef } from "effect";
import { IS_RELEASE, VERSION } from "../app/version";
import { isNewer } from "../lib/versions";

export const PACKAGE = "@collagen/cli";
/** The bin shim relaunches the app when it exits with this code (see bin/collagen.js). */
export const RESTART_EXIT_CODE = 75;

/** How this copy can be brought up to date, decided from where it runs. */
export type InstallPlan =
  | { readonly kind: "source" } // pnpm dev / tsx: git pull is the update
  | { readonly kind: "npx" } // npx re-resolves `latest` on the next start
  | { readonly kind: "global"; readonly cmd: string; readonly args: ReadonlyArray<string> }
  | { readonly kind: "local"; readonly hint: string };

/** Pure: entry path of the running build + versions → plan. */
export function installPlan(entryPath: string, current: string, latest: string): InstallPlan {
  const p = entryPath.replaceAll("\\", "/");
  if (current === "dev") return { kind: "source" };
  if (p.includes("/_npx/")) return { kind: "npx" };
  if (p.includes("/pnpm/global/")) return { kind: "global", cmd: "pnpm", args: ["add", "-g", `${PACKAGE}@${latest}`] };
  if (/\/lib\/node_modules\/@collagen\/cli\//.test(p) || /\/npm\/node_modules\/@collagen\/cli\//.test(p)) {
    return { kind: "global", cmd: "npm", args: ["install", "-g", `${PACKAGE}@${latest}`] };
  }
  return { kind: "local", hint: `npm install ${PACKAGE}@${latest} in the project that installed it` };
}

class RegistryUnreachable extends Data.TaggedError("RegistryUnreachable")<{ readonly cause: unknown }> {}
class InstallFailed extends Data.TaggedError("InstallFailed")<{ readonly detail: string }> {}

export interface UpdateState {
  readonly current: string;
  /** A newer version on the registry, once seen. */
  readonly latest: string | null;
  readonly installing: boolean;
  /** Last thing worth telling the user (an outcome, an instruction, an error). */
  readonly note: string | null;
}

/** Knows whether a newer collagen is on npm, and how to get it. Checks once
 *  shortly after start and every six hours; never nags, never installs on
 *  its own. Off with COLLAGEN_NO_UPDATE_CHECK=1; a source run (`dev`) has
 *  nothing to check. */
export class Updates extends Context.Service<Updates>()("cli/Updates", {
  make: Effect.gen(function* () {
    const state = yield* SubscriptionRef.make<UpdateState>({ current: VERSION, latest: null, installing: false, note: null });
    // only a built artifact can be replaced by a newer one from npm
    const enabled = IS_RELEASE && process.env.COLLAGEN_NO_UPDATE_CHECK !== "1";

    const check = Effect.gen(function* () {
      const version = yield* Effect.tryPromise({
        try: async () => {
          const registry = process.env.COLLAGEN_REGISTRY ?? "https://registry.npmjs.org";
          // registry form: scope kept, slash escaped (@collagen%2Fcli)
          const res = await fetch(`${registry}/${PACKAGE.replace("/", "%2F")}/latest`, {
            signal: AbortSignal.timeout(5000),
            headers: { accept: "application/json" },
          });
          if (!res.ok) throw new Error(`registry answered ${res.status}`);
          const body = (await res.json()) as { version?: string };
          return body.version ?? "";
        },
        catch: (cause) => new RegistryUnreachable({ cause }),
      });
      if (isNewer(version, VERSION)) {
        const seen = (yield* SubscriptionRef.get(state)).latest;
        yield* SubscriptionRef.update(state, (s) => ({ ...s, latest: version }));
        if (seen !== version) yield* Effect.log(`update available: collagen ${version} (you run ${VERSION}) — press u to install`);
      }
    }).pipe(Effect.catch((e) => Effect.logDebug(`update check skipped: ${String(e.cause)}`)));

    if (enabled) {
      yield* check.pipe(
        Effect.delay(Duration.seconds(10)),
        Effect.andThen(check.pipe(Effect.schedule(Schedule.spaced(Duration.hours(6))))),
        Effect.forkScoped,
      );
    }

    /** Bring this copy up to date. Resolves `true` when the new version is
     *  installed and the app should restart; `false` when there was nothing
     *  to run (the note says what to do instead). */
    const install = Effect.gen(function* () {
      const s = yield* SubscriptionRef.get(state);
      if (!s.latest) {
        yield* SubscriptionRef.update(state, (x) => ({ ...x, note: "you are on the latest version" }));
        return false;
      }
      const plan = installPlan(fileURLToPath(import.meta.url), VERSION, s.latest);
      const say = (note: string) => SubscriptionRef.update(state, (x) => ({ ...x, note, installing: false }));
      switch (plan.kind) {
        case "source":
          yield* say("running from source — git pull to update");
          return false;
        case "npx":
          yield* say(`npx picks up ${s.latest} on the next start — quit and run it again`);
          return false;
        case "local":
          yield* say(plan.hint);
          return false;
        case "global": {
          const cmdline = `${plan.cmd} ${plan.args.join(" ")}`;
          yield* SubscriptionRef.update(state, (x) => ({ ...x, installing: true, note: `installing ${s.latest}…` }));
          yield* Effect.log(`update: ${cmdline}`);
          const run = Effect.tryPromise({
            try: () =>
              new Promise<string>((resolve, reject) => {
                execFile(plan.cmd, [...plan.args], { timeout: 180_000, shell: process.platform === "win32" }, (err, stdout, stderr) =>
                  err ? reject(new InstallFailed({ detail: `${err.message}\n${stderr}`.trim() })) : resolve(String(stdout)),
                );
              }),
            catch: (e) => (e instanceof InstallFailed ? e : new InstallFailed({ detail: String(e) })),
          });
          return yield* run.pipe(
            Effect.match({
              onFailure: (e) => ({ ok: false, detail: e.detail }),
              onSuccess: () => ({ ok: true, detail: "" }),
            }),
            Effect.flatMap(({ ok, detail }) =>
              ok
                ? Effect.log(`update installed: collagen ${s.latest} — restarting`).pipe(
                    Effect.andThen(say(`installed ${s.latest} — restarting…`)),
                    Effect.as(true),
                  )
                : Effect.logWarning(`update failed: ${detail.split("\n")[0]}`).pipe(
                    Effect.andThen(say(`install failed — run it yourself: ${cmdline}`)),
                    Effect.as(false),
                  ),
            ),
          );
        }
      }
    });

    return { state, check, install } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
