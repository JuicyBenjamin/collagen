import { Context, Duration, Effect, Layer, Schedule, Schema } from "effect";
import Hyperswarm from "hyperswarm";
import DHT from "hyperdht";
import Corestore from "corestore";
import Protomux from "protomux";
import c from "compact-encoding";
import b4a from "b4a";
import { EnvelopeFromJson, type Bootstrap, type Frame } from "./schema";
import { PeerNotConnected } from "./errors";
import type { Identity } from "./types";

export class SwarmConfig extends Context.Service<SwarmConfig, {
  readonly identity: Identity;
  readonly bootstrap?: Bootstrap;
  /** Directory for this identity's Corestore (the rooms' logs). */
  readonly storage: string;
}>()("p2p/SwarmConfig") {}

/** Minimal structural view of a hyperswarm connection (the lib ships no types). */
interface SwarmConnection {
  on(event: "error", cb: (err: Error) => void): SwarmConnection;
  on(event: "close", cb: () => void): SwarmConnection;
  readonly isInitiator: boolean;
  readonly rawBytesRead: number;
  readonly rawBytesWritten: number;
  readonly rawStream?: { remoteHost?: string; remotePort?: number };
}

interface PeerInfo {
  readonly publicKey: Buffer;
  readonly topics: ReadonlyArray<Buffer>;
  readonly attempts: number;
  readonly proven: boolean;
  readonly banned: boolean;
}

/** What a room plugs into the swarm for its topic. All callbacks are
 *  effects run by the swarm; a room never touches connections. */
export interface TopicHooks {
  /** A frame addressed to this topic arrived from `key`. */
  readonly onFrame: (key: string, frame: Frame) => Effect.Effect<void>;
  /** `key` was discovered on this topic and is connected: introduce
   *  ourselves (idempotent — called again on every discovery sweep). */
  readonly greet: (key: string) => Effect.Effect<void>;
  /** `key`'s connection is gone (or the swarm was recreated). */
  readonly onPeerGone: (key: string) => Effect.Effect<void>;
}

const decodeEnvelope = Schema.decodeUnknownEffect(EnvelopeFromJson);
const encodeEnvelope = Schema.encodeEffect(EnvelopeFromJson);

/**
 * One Hyperswarm per identity — ONE DHT node per keypair, however many rooms.
 * Rooms are topics on it; a peer you share several rooms with is one
 * connection carrying frames for each. (Two DHT nodes announcing the same
 * key made the relayed handshakes land on the wrong node and connections
 * time out — see the 2026-09-07 entry in the docs' status page.)
 */
export class Swarm extends Context.Service<Swarm>()("p2p/Swarm", {
  make: Effect.gen(function* () {
    const config = yield* SwarmConfig;
    const services = yield* Effect.context<never>();
    const runFork = Effect.runForkWith(services);

    /** Per connected peer: how to send one envelope (a Protomux message). */
    const connByKey = new Map<string, { send: (json: string) => void }>();
    const store = new Corestore(config.storage);
    yield* Effect.acquireRelease(
      Effect.promise(() => store.ready() as Promise<void>),
      () => Effect.promise(() => store.close() as Promise<void>).pipe(Effect.ignore),
    );
    const hooksByTopic = new Map<string, TopicHooks>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const discoveries = new Map<string, any>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let swarm: any = null;

    const forEachHook = (f: (topicHex: string, hooks: TopicHooks) => Effect.Effect<void>) =>
      Effect.forEach([...hooksByTopic.entries()], ([t, h]) => f(t, h), { discard: true });

    /** Rooms the peer was discovered on that we are in → greet there. The
     *  hooks make greeting idempotent, so this can run on every sweep. */
    const greetKnownTopics = (key: string) =>
      Effect.suspend(() => {
        if (!connByKey.has(key)) return Effect.void;
        const info = (swarm.peers as Map<string, PeerInfo>).get(key);
        if (!info) return Effect.void;
        return Effect.forEach(
          info.topics,
          (topic) => {
            const hooks = hooksByTopic.get(b4a.toString(topic, "hex"));
            return hooks ? hooks.greet(key) : Effect.void;
          },
          { discard: true },
        );
      });

    const onData = (key: string, json: string) =>
      decodeEnvelope(json).pipe(
        Effect.flatMap(({ topic, frame }) => {
          const hooks = hooksByTopic.get(topic);
          return hooks ? hooks.onFrame(key, frame) : Effect.logDebug(`frame for a room we're not in (${topic.slice(0, 8)}) from ${key.slice(0, 8)}`);
        }),
        Effect.catchTag("SchemaError", (e) =>
          Effect.logWarning(`dropped invalid frame from ${key.slice(0, 8)}: ${String(e.issue).slice(0, 120)}`),
        ),
      );

    const onConnection = (conn: SwarmConnection, info: PeerInfo) => {
      const key = b4a.toString(info.publicKey, "hex");
      const who = `${key.slice(0, 12)} ${conn.isInitiator ? "out" : "in"} ${conn.rawStream?.remoteHost ?? "?"}:${conn.rawStream?.remotePort ?? "?"}`;
      runFork(Effect.log(`swarm connection: ${who}`));
      // One connection carries two protocols over Protomux: Corestore
      // replication (the rooms' logs) and our envelopes. Protomux.from reuses
      // the muxer Corestore attaches, so both ride the same framing.
      const mux = Protomux.from(conn);
      store.replicate(conn);
      const channel = mux.createChannel({ protocol: "collagen/1" });
      if (channel === null) {
        runFork(Effect.logWarning(`duplicate collagen channel on ${who} — ignoring this connection`));
        return;
      }
      const envelopes = channel.addMessage({
        encoding: c.string,
        onmessage: (json: string) => runFork(onData(key, json)),
      });
      channel.open();
      const link = { send: (json: string) => void envelopes.send(json) };
      connByKey.set(key, link);
      let lastError: Error | null = null;
      conn.on("error", (e) => {
        lastError = e;
      });
      conn.on("close", () => {
        // the close reason answers "why didn't they connect?" after the fact
        runFork(
          Effect.log(
            `swarm connection closed: ${who} · r${conn.rawBytesRead}/w${conn.rawBytesWritten}${lastError ? ` · ${lastError.message}` : ""}`,
          ),
        );
        // A replacement connection for the same peer may already be in the
        // book (hyperswarm reconnects overlap) — only forget the peer if the
        // closing connection is still the current one.
        if (connByKey.get(key) === link) {
          connByKey.delete(key);
          runFork(forEachHook((_, h) => h.onPeerGone(key)));
        }
      });
      // Introduce ourselves in the rooms we were both found in. Nothing is
      // said about rooms the peer wasn't discovered on — an invite is a
      // secret, and a peer learns only the rooms it is already in.
      runFork(greetKnownTopics(key));
    };

    /** Build a swarm, attach our handler, join every registered topic. Used
     *  at start and again by the self-heal. */
    const startSwarm = () => {
      // On the local dev testnet every node is on this host, so declare the
      // DHT node reachable (as hyperdht's own testnet helper does for its
      // nodes) instead of letting it probe its NAT: the probe concludes
      // "firewalled", and hyperdht's same-host connect path then fails here
      // (the client dials the LAN address directly while the server waits for
      // a holepunch that never comes). On the public DHT, detection stays on.
      const dht = config.bootstrap ? new DHT({ bootstrap: config.bootstrap, firewalled: false }) : undefined;
      const s = new Hyperswarm({ keyPair: config.identity.keyPair, bootstrap: config.bootstrap, dht });
      s.on("connection", onConnection);
      // peers get their topics as discovery finds them, often after the
      // connection already exists — sweep so late topics still get a greet
      s.on("update", () => runFork(Effect.forEach([...connByKey.keys()], greetKnownTopics, { discard: true })));
      swarm = s;
      runFork(
        Effect.promise(() => s.dht.ready() as Promise<void>).pipe(
          Effect.andThen(() =>
            Effect.log(
              `dht: local ${JSON.stringify(s.dht.localAddress())} · remote ${JSON.stringify(s.dht.remoteAddress())} · firewalled=${String(s.dht.firewalled)}`,
            ),
          ),
          Effect.ignore,
        ),
      );
      for (const topicHex of hooksByTopic.keys()) joinTopic(topicHex);
    };

    const joinTopic = (topicHex: string) => {
      const discovery = swarm.join(b4a.from(topicHex, "hex"), { server: true, client: true });
      discoveries.set(topicHex, discovery);
      // Fire-and-forget: flushed() resolves when fully announced; not required for readiness.
      runFork(Effect.promise(() => discovery.flushed() as Promise<void>).pipe(Effect.timeout("10 seconds"), Effect.ignore));
    };

    // hyperswarm only tears down a DHT it created itself
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const destroySwarm = (s: any) =>
      Effect.promise(async () => {
        await s.destroy();
        if (!s.dht.destroyed) await s.dht.destroy();
      });

    yield* Effect.acquireRelease(Effect.sync(startSwarm), () => destroySwarm(swarm).pipe(Effect.orDie));

    // Peers that join in the same instant can miss each other: each side's
    // topic lookup can run before the other side's announce lands, and
    // hyperswarm's own re-lookup is too infrequent to recover quickly.
    // Periodically re-running announce+lookup makes the room converge; the
    // same tick re-sweeps greetings for topics discovered since. Jittered:
    // two peers dialing each other in the same instant both lose the attempt
    // (hyperdht simultaneous open), and a fixed period keeps them in step.
    yield* Effect.gen(function* () {
      yield* Effect.sleep(Duration.millis(Math.random() * 10_000));
      yield* Effect.forEach(
        [...discoveries.values()],
        (d) => Effect.promise(() => d.refresh({ client: true, server: true }) as Promise<void>).pipe(Effect.ignore),
        { discard: true },
      );
      yield* Effect.forEach([...connByKey.keys()], greetKnownTopics, { discard: true });
    }).pipe(Effect.schedule(Schedule.spaced("10 seconds")), Effect.forkScoped);

    // Swarm health, every minute, but only logged when it changes (or when
    // starving) — so the log file can answer "why aren't they connecting?"
    // after the fact. Per known peer: short key, attempts, proven ✓, banned !.
    const healthLine = (): { line: string; known: number; open: number } => {
      const known = [...(swarm.peers as Map<string, PeerInfo>).values()];
      const open = (swarm.connections as Set<unknown>).size;
      const c = swarm.stats.connects as {
        client: { attempted: number; opened: number; closed: number };
        server: { opened: number; closed: number };
      };
      const peersText = known
        .map((p) => `${b4a.toString(p.publicKey, "hex").slice(0, 8)}:a${p.attempts}${p.proven ? "✓" : ""}${p.banned ? "!" : ""}`)
        .join(" ");
      const line = `swarm: ${open} open · ${swarm.connecting} connecting · ${hooksByTopic.size} topic(s) · known [${peersText || "none"}] · client ${c.client.attempted}/${c.client.opened}/${c.client.closed} · server ${c.server.opened}/${c.server.closed}`;
      return { line, known: known.length, open };
    };

    // Self-heal: two long-running instances can discover each other yet never
    // connect — a hung connection attempt keeps the peer in hyperswarm's
    // _allConnections, which blocks rediscovery, retries AND the other side's
    // inbound attempts (duplicate tie-break). Only a fresh swarm clears it,
    // which used to mean restarting collagen. If we know of peers but hold no
    // connection for two checks in a row, recreate the swarm.
    let lastHealth = "";
    let starving = 0;
    yield* Effect.gen(function* () {
      const { line, known, open } = healthLine();
      starving = known > 0 && open === 0 ? starving + 1 : 0;
      if (line !== lastHealth || starving > 0) {
        lastHealth = line;
        yield* Effect.log(line);
      }
      if (starving < 2) return;
      starving = 0;
      yield* Effect.logWarning(`${known} peer(s) known but none connected for 2 min — recreating the swarm`);
      yield* destroySwarm(swarm).pipe(Effect.timeout("15 seconds"), Effect.ignore);
      const gone = [...connByKey.keys()];
      connByKey.clear();
      discoveries.clear();
      yield* Effect.forEach(gone, (key) => forEachHook((_, h) => h.onPeerGone(key)), { discard: true });
      yield* Effect.sync(startSwarm);
    }).pipe(Effect.schedule(Schedule.spaced("60 seconds")), Effect.forkScoped);

    /** Be in a room: announce+look up its topic and route its frames to the
     *  hooks. Scoped — closing the scope leaves the topic. */
    const join = Effect.fn("Swarm.join")(function* (topic: Buffer, hooks: TopicHooks) {
      const topicHex = b4a.toString(topic, "hex");
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          hooksByTopic.set(topicHex, hooks);
          joinTopic(topicHex);
        }),
        () =>
          Effect.gen(function* () {
            hooksByTopic.delete(topicHex);
            const d = discoveries.get(topicHex);
            discoveries.delete(topicHex);
            if (d) yield* Effect.promise(() => d.destroy() as Promise<void>).pipe(Effect.timeout("5 seconds"), Effect.ignore);
          }),
      );
      // peers already connected through other rooms may be in this one too
      yield* Effect.forEach([...connByKey.keys()], greetKnownTopics, { discard: true });
      return topicHex;
    });

    /** Send one frame to one peer, addressed to a room. Failures other than
     *  "not connected" are logged, not fatal — a peer mid-teardown behaves
     *  like a lost packet. */
    const write = (key: string, topicHex: string, frame: Frame) =>
      Effect.suspend(() => {
        const conn = connByKey.get(key);
        if (!conn) return Effect.fail(new PeerNotConnected({ peerKey: key }));
        return encodeEnvelope({ topic: topicHex, frame }).pipe(
          Effect.flatMap((json) => Effect.sync(() => conn.send(json))),
          // warn, not debug: a silently dropped frame looks exactly like "peer
          // never answered" and has cost hours of misdiagnosis
          Effect.catch((e) => Effect.logWarning(`frame write failed (${frame.kind}): ${String(e).slice(0, 160)}`)),
        );
      });

    return {
      identity: config.identity,
      /** This identity's Corestore — rooms keep their logs in namespaces of it. */
      store,
      join,
      write,
    } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
