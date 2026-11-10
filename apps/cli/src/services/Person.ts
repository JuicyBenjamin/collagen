import { hostname } from "node:os";
import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { makePerson, PersonConfig } from "@collagen/p2p";
import { NET } from "../app/net";
import { CliArgs } from "./CliArgs";
import { IdentityService } from "./Identity";
import { writeProfileFile } from "../config/profileFile";
import { readPersonFile, writePersonFile } from "../config/personFile";

/** The person this device is: alone, or one of several devices (p2p Person). */
export class PersonService extends Context.Service<PersonService>()("cli/Person", {
  make: Effect.gen(function* () {
    const { profile } = yield* CliArgs;
    const { nameRef, setName } = yield* IdentityService;
    const made = yield* makePerson.pipe(
      Effect.provideService(PersonConfig, {
        net: NET,
        stored: readPersonFile(profile),
        save: (stored) => Effect.sync(() => writePersonFile(profile, stored)),
        // a run with a profile of its own is told apart by it: two of them on one machine share a hostname
        deviceName: profile === "default" ? hostname() : `${hostname()} (${profile})`,
      }),
    );
    // one person, one name: the first device to share the log says its own,
    // and every device takes the name the log holds
    yield* SubscriptionRef.changes(made.state).pipe(
      Stream.tap((mine) =>
        Effect.gen(function* () {
          const here = yield* SubscriptionRef.get(nameRef);
          if (mine.name === null) return mine.writable && mine.device === mine.parent ? yield* made.rememberName(here) : undefined;
          if (mine.name === here) return;
          yield* Effect.sync(() => writeProfileFile(profile, { name: mine.name! }));
          yield* setName(mine.name);
        }),
      ),
      Stream.runDrain,
      Effect.forkScoped,
    );
    return made;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
