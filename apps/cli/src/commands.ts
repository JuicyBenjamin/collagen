import { userInfo } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Option, SubscriptionRef } from "effect";
import { NodeServices } from "@effect/platform-node";
import { keyPairFromSeed, makePerson, PersonConfig, pubkeyHex, randomSeedHex, Swarm, SwarmConfig, type PersonState } from "@collagen/p2p";
import { NET } from "./app/net";
import { forgetPersonFile, readPersonFile, writePersonFile } from "./config/personFile";
import { invitedRoomEntry, readProfileFile, upsertActiveRoom, writeProfileFile } from "./config/profileFile";
import { checkInvite } from "./lib/invite";
import { loadDevBootstrap } from "./services/DevBootstrap";
import { configDir } from "./services/Identity";
import { portForProfile } from "./services/mcpAddress";

// What a person types before the app is up: `collagen join <invite>` and
// `collagen connect-device <code>`. Each does what its tool does (join-room,
// take-identity), so nothing is set up by hand. With collagen already running
// for the profile it is handed to that one; otherwise it is done here, and
// the app then starts in the room, or as the person.

const COMMANDS = ["join", "connect-device"] as const;
type CommandName = (typeof COMMANDS)[number];

/** `join <invite>` or `connect-device <code>` at the front of the arguments, with what is left for the app; null when it is neither. */
export const commandIn = (argv: ReadonlyArray<string>): { readonly command: CommandName; readonly value: string | undefined; readonly rest: ReadonlyArray<string> } | null => {
  const command = COMMANDS.find((name) => name === argv[0]);
  if (!command) return null;
  const value = argv[1] !== undefined && !argv[1].startsWith("-") ? argv[1] : undefined;
  return { command, value, rest: argv.slice(value === undefined ? 1 : 2) };
};

const profileIn = (argv: ReadonlyArray<string>): string => {
  const at = argv.findIndex((argument) => argument === "--profile" || argument === "-p");
  return (at === -1 ? undefined : argv[at + 1]) ?? "default";
};

const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

/** Ask the collagen already running for this profile to do one of its tools; null when none is running. */
const askRunning = async (profile: string, tool: string, input: Record<string, string>): Promise<string | null> => {
  const url = `http://127.0.0.1:${portForProfile(profile)}/mcp`;
  try {
    const opened = await fetch(url, {
      method: "POST",
      headers: HEADERS,
      signal: AbortSignal.timeout(1500),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "collagen-cli", version: "0" } } }),
    });
    const session = opened.headers.get("mcp-session-id");
    if (!session) return null;
    const headers = { ...HEADERS, "mcp-session-id": session, "MCP-Protocol-Version": "2025-06-18" };
    await fetch(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    const answered = await fetch(url, { method: "POST", headers, signal: AbortSignal.timeout(30_000), body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: input } }) });
    const text = await answered.text();
    // a plain answer, or one event of a stream
    const body = text.trimStart().startsWith("{") ? text : (text.split("\n").find((line) => line.startsWith("data:"))?.slice(5) ?? "");
    const parsed = JSON.parse(body) as { result?: { content?: ReadonlyArray<{ text?: string }> } };
    return parsed.result?.content?.[0]?.text ?? "";
  } catch {
    return null;
  }
};

/** A name to start with on a machine that has none: the person's, when known, else the account's. */
const nameFor = (profile: string, known: string | null = null): string => known ?? readProfileFile(profile).name ?? userInfo().username;

/** How long the machine that made a device code is looked for. */
const FIND_PATIENCE = "90 seconds";

/** Become one of a person's devices before the app is up: just the swarm
 *  and the person, no rooms. Returns once their log names this device, with
 *  what it says of them; null when nobody answered. */
const connectDevice = (profile: string, code: string) =>
  Effect.gen(function* () {
    const stored = readProfileFile(profile);
    const seed = stored.seed ?? randomSeedHex();
    if (stored.seed === undefined) writeProfileFile(profile, { seed });
    const keyPair = keyPairFromSeed(seed);
    const device = pubkeyHex(keyPair.publicKey);
    const bootstrap = Option.getOrUndefined(yield* loadDevBootstrap);
    const swarm = Swarm.layer.pipe(Layer.provide(Layer.succeed(SwarmConfig, { identity: { name: "", profile, keyPair, pubkey: device, device }, ...(bootstrap ? { bootstrap } : {}), storage: join(configDir, `store-${profile}`) })));
    return yield* Effect.gen(function* () {
      const person = yield* makePerson;
      const asked = yield* person.useCode(code);
      if (asked !== "asked") return asked;
      const theirs = (mine: PersonState) => mine.person !== device;
      const linked = yield* Effect.gen(function* () {
        while (!theirs(yield* SubscriptionRef.get(person.state))) yield* Effect.sleep("200 millis");
        // their rooms and their name follow the acts: give them a moment to come
        for (let waits = 0; waits < 25 && (yield* SubscriptionRef.get(person.state)).name === null; waits++) yield* Effect.sleep("200 millis");
        return yield* SubscriptionRef.get(person.state);
      }).pipe(Effect.timeoutOption(FIND_PATIENCE));
      return Option.getOrNull(linked);
    }).pipe(
      Effect.provideService(PersonConfig, { net: NET, stored: readPersonFile(profile), save: (kept) => Effect.sync(() => writePersonFile(profile, kept)), forget: Effect.sync(() => forgetPersonFile(profile)), deviceName: nameFor(profile) }),
      Effect.provide(swarm),
      Effect.scoped,
    );
  }).pipe(Effect.provide(NodeServices.layer));

/** Run a command typed before the app is up. Returns the arguments the app
 *  starts with, or null when it was handed to a running collagen, or
 *  could not be done — said on the terminal either way. */
export const runCommand = async (argv: ReadonlyArray<string>): Promise<ReadonlyArray<string> | null> => {
  const typed = commandIn(argv);
  if (!typed) return argv;
  const profile = profileIn(typed.rest);
  const say = (line: string) => void process.stdout.write(`${line}\n`);
  if (typed.value === undefined) {
    say(typed.command === "join" ? "collagen join <invite> — the invite someone sent you" : "collagen connect-device <code> — the code from your other machine");
    return null;
  }
  if (typed.command === "join") {
    const check = checkInvite(typed.value);
    if (!check.ok) return say(check.reason), null;
    const running = await askRunning(profile, "join-room", { invite: typed.value });
    if (running !== null) return say(running), null;
    writeProfileFile(profile, { name: nameFor(profile) });
    upsertActiveRoom(profile, readProfileFile(profile).rooms?.find((room) => room.id === check.invite.roomName) ?? invitedRoomEntry(check.invite.roomName, typed.value));
    return typed.rest;
  }
  const running = await askRunning(profile, "take-identity", { code: typed.value });
  if (running !== null) return say(running), null;
  say("Looking for the machine that made this code…");
  const outcome = await Effect.runPromise(connectDevice(profile, typed.value));
  switch (outcome) {
    case "not-a-code":
      return say("That is not a device code."), null;
    case "other-net":
      return say("That code is from another net: a release and a run from source do not meet."), null;
    case "already-linked":
      return say("This machine is already one of someone's devices, or has devices of its own."), null;
    case null:
      return say("Nobody answered. The code is good for ten minutes, and collagen has to be open on the machine that made it."), null;
  }
  // as them from the first frame: their name, their rooms
  const rooms = outcome.rooms.flatMap((room) => (room.logKey && room.encryptionKey ? [{ id: room.id, name: room.name, logKey: room.logKey, encryptionKey: room.encryptionKey }] : []));
  const before = readProfileFile(profile);
  const known = new Set((before.rooms ?? []).map((room) => room.id));
  writeProfileFile(profile, {
    name: nameFor(profile, outcome.name),
    rooms: [...(before.rooms ?? []), ...rooms.filter((room) => !known.has(room.id))],
    ...(before.activeRoomId === undefined && rooms[0] ? { activeRoomId: rooms[0].id } : {}),
  });
  say(`This machine is now one of ${nameFor(profile, outcome.name)}'s devices.`);
  return typed.rest;
};
