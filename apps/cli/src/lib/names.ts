/** A name is a name however it is cased. Names reach the tools typed by a
 *  model repeating what a person said — "juicy" for Juicy — and casing is
 *  noise in that, never meaning. One resolver for every place a peer or a
 *  project is named, so no site drifts back to an exact compare.
 *
 *  Only case and surrounding whitespace are forgiven. Anything fuzzier
 *  (prefixes, edit distance) is the tool deciding whom the person meant, and
 *  a review sent to the wrong person is worse than a refusal. */

/** The comparable form of a name. */
export const nameKey = (name: string): string => name.trim().toLowerCase();

export const sameName = (a: string, b: string): boolean => nameKey(a) === nameKey(b);

export type Resolved<T> =
  | { readonly _tag: "found"; readonly value: T }
  /** two different holders whose names differ by case alone, and neither was
   *  typed exactly: refuse rather than pick */
  | { readonly _tag: "ambiguous"; readonly names: ReadonlyArray<string> }
  | { readonly _tag: "missing" };

/** Find one entry by name across pools searched in order (present peers
 *  first, then the members the log remembers). An exact spelling wins
 *  outright; otherwise a case-insensitive match, refused as ambiguous when
 *  it fits two different holders. `id` tells holders apart, so the same
 *  person in two pools is one match, not two. */
export function resolveName<T extends { readonly name: string }>(
  name: string,
  pools: ReadonlyArray<ReadonlyArray<T>>,
  id: (t: T) => string = (t) => t.name,
): Resolved<T> {
  const typed = name.trim();
  for (const pool of pools) {
    const exact = pool.find((t) => t.name === typed);
    if (exact) return { _tag: "found", value: exact };
  }
  const hits = new Map<string, T>();
  for (const pool of pools) for (const t of pool) if (sameName(t.name, typed) && !hits.has(id(t))) hits.set(id(t), t);
  const found = [...hits.values()];
  if (found.length === 1) return { _tag: "found", value: found[0]! };
  if (found.length > 1) return { _tag: "ambiguous", names: found.map((t) => t.name) };
  return { _tag: "missing" };
}

/** The room as names, for a miss: who is here, who is away, who is
 *  remembered but offline — so an agent that guessed wrong is handed the
 *  right answer in the refusal instead of being sent to list-room. */
export function roomRollCall(
  peers: ReadonlyArray<{ readonly key: string; readonly name: string; readonly away?: boolean }>,
  members: ReadonlyArray<{ readonly key: string; readonly name: string }>,
  me: string,
): string {
  const present = peers.filter((p) => p.key !== me).map((p) => (p.away ? `${p.name} (away)` : p.name));
  const offline = members.filter((m) => m.key !== me && !peers.some((p) => p.key === m.key)).map((m) => `${m.name} (offline)`);
  const all = [...present, ...offline];
  return all.length > 0 ? `in the room: ${all.join(", ")}` : "nobody else is in this room yet";
}

/** The one sentence every site says when a peer name does not resolve. */
export function noPeerNamed(
  name: string,
  outcome: Exclude<Resolved<unknown>, { _tag: "found" }>,
  rollCall: string,
): string {
  return outcome._tag === "ambiguous"
    ? `failed: "${name.trim()}" could be ${outcome.names.join(" or ")} — their names differ only by case, so spell the one you mean exactly`
    : `failed: no one here is called ${name.trim()} — ${rollCall}`;
}

export interface Person {
  readonly key: string;
  readonly name: string;
}

/** A person in the room by name: `self` first when the site lets the user
 *  name themselves (a step they own), then present peers, then members the
 *  log remembers — they read it when they are next online. A miss is the
 *  refusal text, room included. */
export function personNamed(
  name: string,
  room: {
    readonly peers: ReadonlyArray<Person & { readonly away?: boolean }>;
    readonly members: ReadonlyArray<Person>;
    readonly me: string;
    readonly self?: Person;
  },
): { readonly _tag: "found"; readonly person: Person } | { readonly _tag: "refused"; readonly text: string } {
  const pools: ReadonlyArray<ReadonlyArray<Person>> = [...(room.self ? [[room.self]] : []), room.peers, room.members];
  const r = resolveName(name, pools, (p) => p.key);
  if (r._tag === "found") return { _tag: "found", person: { key: r.value.key, name: r.value.name } };
  return { _tag: "refused", text: noPeerNamed(name, r, roomRollCall(room.peers, room.members, room.me)) };
}

/** A project as the room spells it: yours first, then the peers' shares.
 *  Threads are keyed by project name, so "Collagen" and "collagen" would be
 *  two conversations about one project; a name nobody shares is kept as
 *  typed (trimmed) — a message may be about a project only the peer has. */
export function projectSpelling(
  name: string,
  peers: ReadonlyArray<{ readonly projects: ReadonlyArray<{ readonly name: string }> }>,
  mine: ReadonlyArray<{ readonly name: string }>,
): string {
  const r = resolveName(name, [mine, peers.flatMap((p) => p.projects)]);
  return r._tag === "found" ? r.value.name : name.trim();
}
