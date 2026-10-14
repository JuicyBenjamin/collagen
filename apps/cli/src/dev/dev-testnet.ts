import { dirname } from "node:path";
import { Console, Effect, Layer } from "effect";
import { FileSystem } from "effect";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import createTestnet from "hyperdht/testnet.js";
import { bootstrapFile } from "../services/DevBootstrap";

// Local DHT for development: lets same-machine peers connect deterministically
// (the public DHT hairpins on localhost). Keep this running, then start clients.
const TestnetLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    // hyperdht ships no types
    const testnet = yield* Effect.acquireRelease(
      Effect.promise<any>(() => createTestnet(3)),
      (running) => Effect.promise(() => running.destroy() as Promise<void>),
    );
    yield* fileSystem.makeDirectory(dirname(bootstrapFile), { recursive: true });
    // pid included so clients can detect a stale file from a killed testnet
    yield* fileSystem.writeFileString(bootstrapFile, JSON.stringify({ pid: process.pid, bootstrap: testnet.bootstrap }));
    yield* Effect.addFinalizer(() => fileSystem.remove(bootstrapFile).pipe(Effect.ignore));
    yield* Console.log("collagen dev testnet running.");
    yield* Console.log(`bootstrap: ${JSON.stringify(testnet.bootstrap)}`);
    yield* Console.log(`wrote ${bootstrapFile}`);
    yield* Console.log("clients will auto-use it. ctrl+c to stop.");
  }),
).pipe(Layer.provide(NodeServices.layer));

NodeRuntime.runMain(Layer.launch(TestnetLive));
