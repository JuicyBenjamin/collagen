import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { Effect, Layer } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import createTestnet from "hyperdht/testnet.js";
import { bootstrapFile } from "@collagen/p2p";

// Local DHT for development: lets same-machine peers connect deterministically
// (the public DHT hairpins on localhost). Keep this running, then start clients.
const TestnetLive = Layer.scopedDiscard(
  Effect.acquireRelease(
    Effect.gen(function* () {
      // hyperdht ships no types
      const testnet = yield* Effect.promise<any>(() => createTestnet(3));
      mkdirSync(dirname(bootstrapFile), { recursive: true });
      writeFileSync(bootstrapFile, JSON.stringify(testnet.bootstrap));
      yield* Effect.sync(() => {
        console.log("collagen dev testnet running.");
        console.log("bootstrap:", JSON.stringify(testnet.bootstrap));
        console.log(`wrote ${bootstrapFile}`);
        console.log("clients will auto-use it. ctrl+c to stop.");
      });
      return testnet;
    }),
    (testnet) =>
      Effect.promise(async () => {
        rmSync(bootstrapFile, { force: true });
        await testnet.destroy();
      }),
  ),
);

NodeRuntime.runMain(Layer.launch(TestnetLive));
