import { Config, Effect, Option } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** The browser's own opener for this platform — or COLLAGEN_OPENER, a
 *  program handed the url instead (a browser of the person's choosing, or a
 *  test that must never open one). */
export const openerOverride: Effect.Effect<Option.Option<string>> = Effect.gen(function* () {
  return yield* Config.option(Config.String("COLLAGEN_OPENER"));
}).pipe(Effect.orElseSucceed(() => Option.none()));

const platformOpener = (url: string): ChildProcess.Command =>
  process.platform === "darwin"
    ? ChildProcess.make("open", [url])
    : process.platform === "win32"
      ? ChildProcess.make("cmd", ["/c", "start", "", url])
      : ChildProcess.make("xdg-open", [url]);

/** Opens `url` in the person's browser; whether that worked. */
export const openInBrowser = Effect.fn("openInBrowser")(function* (url: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const override = yield* openerOverride;
  const command = Option.match(override, { onNone: () => platformOpener(url), onSome: (cmd) => ChildProcess.make(cmd, [url]) });
  return yield* spawner.exitCode(command).pipe(
    Effect.map((code) => code === 0),
    Effect.orElseSucceed(() => false),
  );
});
