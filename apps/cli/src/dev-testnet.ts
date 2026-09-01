import { dirname } from "node:path";
import { Console, Effect, Layer } from "effect";
import { FileSystem } from "effect";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import createTestnet from "hyperdht/testnet.js";
import { bootstrapFile } from "./services/DevBootstrap";

// Local DHT for development: lets same-machine peers connect deterministically
// (the public DHT hairpins on localhost). Keep this running, then start clients.
const TestnetLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    // hyperdht ships no types
    const testnet = yield* Effect.acquireRelease(
      Effect.promise<any>(() => createTestnet(3)),
      (t) => Effect.promise(() => t.destroy() as Promise<void>),
    );
    yield* fs.makeDirectory(dirname(bootstrapFile), { recursive: true });
    yield* fs.writeFileString(bootstrapFile, JSON.stringify(testnet.bootstrap));
    yield* Effect.addFinalizer(() => fs.remove(bootstrapFile).pipe(Effect.ignore));
    yield* Console.log("collagen dev testnet running.");
    yield* Console.log(`bootstrap: ${JSON.stringify(testnet.bootstrap)}`);
    yield* Console.log(`wrote ${bootstrapFile}`);
    yield* Console.log("clients will auto-use it. ctrl+c to stop.");
  }),
).pipe(Layer.provide(NodeServices.layer));

NodeRuntime.runMain(Layer.launch(TestnetLive));
