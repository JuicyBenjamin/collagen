import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { makePerson, PersonConfig, type PersonStored } from "@collagen/p2p";
import { NET } from "../app/net";
import { CliArgs } from "./CliArgs";
import { configDir } from "./Identity";

/** Where this device keeps how to open its person's own log again. A file of
 *  its own: the identity file is rewritten whole on start. */
const storedPath = (profile: string) => join(configDir, `person-${profile}.json`);

const readStored = (profile: string): PersonStored | null => {
  try {
    const kept = JSON.parse(readFileSync(storedPath(profile), "utf8")) as Partial<PersonStored>;
    return typeof kept.person === "string" && typeof kept.logKey === "string" && typeof kept.encryptionKey === "string" ? { person: kept.person, logKey: kept.logKey, encryptionKey: kept.encryptionKey } : null;
  } catch {
    return null;
  }
};

/** The person this device is: alone, or one of several devices (p2p Person). */
export class PersonService extends Context.Service<PersonService>()("cli/Person", {
  make: Effect.gen(function* () {
    const { profile } = yield* CliArgs;
    return yield* makePerson.pipe(
      Effect.provideService(PersonConfig, {
        net: NET,
        stored: readStored(profile),
        save: (stored) =>
          Effect.sync(() => {
            if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
            writeFileSync(storedPath(profile), JSON.stringify(stored), { mode: 0o600 });
          }),
        // a run with a profile of its own is told apart by it: two of them on one machine share a hostname
        deviceName: profile === "default" ? hostname() : `${hostname()} (${profile})`,
      }),
    );
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
