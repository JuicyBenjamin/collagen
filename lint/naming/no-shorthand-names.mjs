/**
 * No shorthand names: every parameter and variable says what it holds.
 *
 * A reader should understand a line at a glance. `t`, `p`, `q`, `i` and
 * `res` make them stop and work out what each one is; `ticket`, `project`,
 * `query`, `index` and `response` do not.
 *
 * Bad:  tickets.map((t) => t.id)
 * Good: tickets.map((ticket) => ticket.id)
 *
 * Bad:  const r = yield* host.pull(link, base)
 * Good: const named = yield* host.pull(link, base)
 *
 * Checked: function and arrow parameters, catch parameters, every name a
 * declaration binds (const, let, var, for…of, destructuring), and the fields
 * of types and interfaces declared here.
 *
 * Flagged: one-letter names; two-letter names that are not words (`pr`,
 * `mb`); and the abbreviations below.
 *
 * Allowed:
 *   - `_` and `_`-prefixed names (unused on purpose)
 *   - as a type's field: `ts` and `op`, as the stored records name them, and
 *     `x` and `y`, coordinates
 *   - `a` and `b` in a `.sort()` / `.toSorted()` comparator
 *   - a property kept by its own name in a destructuring is still checked:
 *     write `{ t: ticket }`, not `{ t }`
 */

// two-letter names that are words
const WORDS = new Set(["ai", "id", "at", "by", "to", "of", "in", "on", "up", "ok", "me", "us", "no", "is", "as", "do", "go", "it", "or", "so", "if", "an", "we"]);

const ABBREVIATIONS = new Set(["el", "elem", "evt", "err", "fn", "cb", "idx", "val", "acc", "cur", "curr", "res", "req", "ctx", "obj", "arr", "str", "num", "arg", "msg", "cfg", "opts", "tmp", "len", "buf"]);

const HINTS = {
  e: "`event`, or `error` where it was caught",
  i: "`index`, or what it counts",
  j: "`index`, or what it counts",
  k: "`key`",
  n: "`count`, `size`, or what it counts",
  t: "`ticket`, `theme`, or what it holds",
  p: "`project`, `peer`, `page`, or what it holds",
  q: "`query`",
  r: "`result`, `review`, or what it holds",
  s: "what it holds",
  m: "`merge`, `message`, or what it holds",
  d: "`decision`, or what it holds",
  el: "`element`",
  elem: "`element`",
  evt: "`event`",
  err: "`error`",
  fn: "what it does: `onPick`, `toRow`",
  cb: "what it does: `onDone`",
  idx: "`index`",
  val: "`value`, or what it holds",
  acc: "`accumulator`, or what it gathers",
  cur: "`current`",
  curr: "`current`",
  res: "`result` or `response`",
  req: "`request`",
  ctx: "`context`",
  obj: "what it holds",
  arr: "what it holds",
  str: "what it holds",
  num: "what it counts",
  arg: "`argument`, or what it holds",
  msg: "`message`",
  cfg: "`config`",
  opts: "`options`",
  tmp: "what it holds",
  len: "`length`",
  buf: "`buffer`",
};

// fields kept as the stored records name them (`ts`, `op`), and coordinates
const FIELDS = new Set(["ts", "op", "x", "y"]);

const COMPARATORS = new Set(["sort", "toSorted"]);

const isShorthand = (name) => !name.startsWith("_") && (name.length === 1 || (name.length === 2 && !WORDS.has(name)) || ABBREVIATIONS.has(name));

/** Is `callback` the comparator handed to `.sort()` / `.toSorted()`? */
const isComparator = (callback) => {
  const call = callback?.parent;
  return call?.type === "CallExpression" && call.arguments.includes(callback) && call.callee?.type === "MemberExpression" && call.callee.property?.type === "Identifier" && COMPARATORS.has(call.callee.property.name);
};

/** Every name a binding pattern introduces. */
function* bound(pattern) {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier":
      yield pattern;
      return;
    case "AssignmentPattern":
      yield* bound(pattern.left);
      return;
    case "RestElement":
      yield* bound(pattern.argument);
      return;
    case "ArrayPattern":
      for (const element of pattern.elements) yield* bound(element);
      return;
    case "ObjectPattern":
      for (const property of pattern.properties) yield* bound(property.type === "RestElement" ? property : property.value);
      return;
  }
}

export default {
  meta: {
    type: "suggestion",
    docs: { description: "Disallow shorthand names: say what a parameter or variable holds." },
    schema: [],
    messages: { shorthand: "`{{name}}` is shorthand — name it for what it holds: {{hint}}." },
  },
  create(context) {
    const check = (pattern, callback) => {
      for (const id of bound(pattern)) {
        if (!isShorthand(id.name)) continue;
        if ((id.name === "a" || id.name === "b") && isComparator(callback)) continue;
        context.report({ node: id, messageId: "shorthand", data: { name: id.name, hint: HINTS[id.name] ?? "what it holds" } });
      }
    };
    const params = (callback) => callback.params.forEach((param) => check(param, callback));
    return {
      ArrowFunctionExpression: params,
      FunctionExpression: params,
      FunctionDeclaration: params,
      CatchClause: (node) => check(node.param, null),
      VariableDeclarator: (node) => check(node.id, null),
      // a field of a type declared here: `{ m: HostMerge; p: number }` reads as `best.m`
      TSPropertySignature: (node) => {
        if (node.key?.type === "Identifier" && !node.computed && !FIELDS.has(node.key.name)) check(node.key, null);
      },
    };
  },
};
