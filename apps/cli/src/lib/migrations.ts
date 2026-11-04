// A review's migrations, read apart from its code. What a reviewer asks of
// a migration is what it does to the schema, and whether it can be undone —
// so each is read as its changes: tables made or dropped, columns added,
// dropped, changed or renamed, indexes — what loses data marked — and a
// migration that already existed and was edited said so, since it may have
// run already. Read from SQL and from Rails', Django's and Laravel's own
// migrations; its lines a click away. Pure: services/ReviewView reads the texts.

/** A migration: a file in a migrations folder of a kind collagen knows. */
export const isMigration = (file: string): boolean =>
  /(^|\/)(migrations?|db\/migrate|migrate|alembic\/versions)\/[^/]+(\/migration)?\.(sql|rb|py|php)$/.test(file) || /(^|\/)prisma\/migrations\/[^/]+\/migration\.sql$/.test(file);

/** One change a migration makes to the schema. */
export interface SchemaChange {
  readonly action: string;
  readonly table: string;
  /** the column or index, when the change is to one */
  readonly target?: string;
  /** its type, its columns, what it becomes */
  readonly detail?: string;
  /** whether undoing it cannot bring back what was there */
  readonly losesData: boolean;
}

const bare = (name: string): string => name.trim().replace(/^[`"[]|[`"\]]$/g, "").replace(/^.*\./, "");

/** Splits on commas at the top level, not inside parentheses. */
const topLevel = (text: string): ReadonlyArray<string> => {
  const parts: Array<string> = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
};

const sqlChanges = (text: string): ReadonlyArray<SchemaChange> => {
  const statements = text
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter((statement) => statement.length > 0);
  const changes: Array<SchemaChange> = [];
  for (const statement of statements) {
    const create = /^CREATE TABLE (?:IF NOT EXISTS )?(\S+) ?\((.*)\)$/i.exec(statement);
    if (create) {
      const columns = topLevel(create[2]!)
        .filter((part) => !/^(PRIMARY KEY|CONSTRAINT|FOREIGN KEY|UNIQUE|CHECK|INDEX|KEY)\b/i.test(part))
        .map((part) => bare(part.split(" ")[0]!));
      changes.push({ action: "create table", table: bare(create[1]!), detail: columns.join(", "), losesData: false });
      continue;
    }
    const drop = /^DROP TABLE (?:IF EXISTS )?(.+?)(?: CASCADE| RESTRICT)?$/i.exec(statement);
    if (drop) {
      for (const table of topLevel(drop[1]!)) changes.push({ action: "drop table", table: bare(table), losesData: true });
      continue;
    }
    const alter = /^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(\S+) (.*)$/i.exec(statement);
    if (alter) {
      const table = bare(alter[1]!);
      for (const part of topLevel(alter[2]!)) {
        const add = /^ADD (?:COLUMN )?(?:IF NOT EXISTS )?(?!CONSTRAINT\b)(\S+) (.*)$/i.exec(part);
        const dropColumn = /^DROP (?:COLUMN )?(?:IF EXISTS )?(?!CONSTRAINT\b)(\S+)/i.exec(part);
        const rename = /^RENAME (?:COLUMN )?(\S+) TO (\S+)$/i.exec(part);
        const renameTable = /^RENAME TO (\S+)$/i.exec(part);
        const type = /^ALTER (?:COLUMN )?(\S+) (?:SET DATA )?TYPE (.*)$/i.exec(part);
        const column = /^ALTER (?:COLUMN )?(\S+) (.*)$/i.exec(part);
        const constraint = /^(ADD|DROP) CONSTRAINT (\S+)/i.exec(part);
        if (renameTable) changes.push({ action: "rename table", table, detail: bare(renameTable[1]!), losesData: false });
        else if (rename) changes.push({ action: "rename column", table, target: bare(rename[1]!), detail: bare(rename[2]!), losesData: false });
        else if (constraint) changes.push({ action: `${constraint[1]!.toLowerCase()} constraint`, table, target: bare(constraint[2]!), losesData: false });
        else if (add) changes.push({ action: "add column", table, target: bare(add[1]!), detail: add[2]!, losesData: false });
        else if (dropColumn) changes.push({ action: "drop column", table, target: bare(dropColumn[1]!), losesData: true });
        else if (type) changes.push({ action: "change column", table, target: bare(type[1]!), detail: `type ${type[2]!}`, losesData: true });
        else if (column) changes.push({ action: "change column", table, target: bare(column[1]!), detail: column[2]!.toLowerCase(), losesData: false });
        else changes.push({ action: "alter table", table, detail: part, losesData: false });
      }
      continue;
    }
    const index = /^CREATE (UNIQUE )?INDEX (?:CONCURRENTLY )?(?:IF NOT EXISTS )?(\S+) ON (\S+) ?\((.*)\)/i.exec(statement);
    if (index) {
      changes.push({ action: index[1] ? "add unique index" : "add index", table: bare(index[3]!), target: bare(index[2]!), detail: topLevel(index[4]!).map(bare).join(", "), losesData: false });
      continue;
    }
    const dropIndex = /^DROP INDEX (?:CONCURRENTLY )?(?:IF EXISTS )?(\S+)/i.exec(statement);
    if (dropIndex) {
      changes.push({ action: "drop index", table: "", target: bare(dropIndex[1]!), losesData: false });
      continue;
    }
    const rows = /^(DELETE FROM|TRUNCATE(?: TABLE)?|UPDATE) (\S+)/i.exec(statement);
    if (rows) {
      const verb = rows[1]!.toUpperCase();
      changes.push({ action: verb.startsWith("UPDATE") ? "update rows" : "delete rows", table: bare(rows[2]!), losesData: !verb.startsWith("UPDATE") });
      continue;
    }
    if (/^INSERT INTO (\S+)/i.test(statement)) changes.push({ action: "insert rows", table: bare(/^INSERT INTO (\S+)/i.exec(statement)![1]!), losesData: false });
  }
  return changes;
};

/** What runs forward: a migration's own way back (down, downgrade) left out. */
const forward = (text: string): string => {
  const down = /^\s*(def down\b|def downgrade\b|public function down\s*\()/m.exec(text);
  return down ? text.slice(0, down.index) : text;
};

const railsChanges = (text: string): ReadonlyArray<SchemaChange> => {
  const changes: Array<SchemaChange> = [];
  let creating: { table: string; columns: Array<string> } | null = null;
  const flush = () => {
    if (creating) changes.push({ action: "create table", table: creating.table, detail: creating.columns.join(", "), losesData: false });
    creating = null;
  };
  for (const line of forward(text).split("\n")) {
    const create = /create_table[ (]:?["']?(\w+)/.exec(line);
    if (create) {
      flush();
      creating = { table: create[1]!, columns: [] };
      continue;
    }
    if (creating && /^\s*t\.timestamps\b/.test(line)) {
      creating.columns.push("created_at", "updated_at");
      continue;
    }
    const column = /^\s*t\.(\w+)[ (]+:?["']?(\w+)/.exec(line);
    if (creating && column) {
      creating.columns.push(column[1] === "references" || column[1] === "belongs_to" ? `${column[2]}_id` : column[2]!);
      continue;
    }
    if (/^\s*end\b/.test(line) && creating) {
      flush();
      continue;
    }
    const call = /^\s*(add_column|remove_column|rename_column|change_column|drop_table|rename_table|add_index|remove_index|add_reference|remove_reference)[ (]+:?["']?(\w+)["']?(?:,\s*\[?:?["']?(\w+)["']?\]?)?(?:,\s*:?["']?(\w+)["']?)?/.exec(line);
    if (!call) continue;
    const [, verb, table, second, third] = call;
    const action: Record<string, SchemaChange> = {
      add_column: { action: "add column", table: table!, target: second!, ...(third ? { detail: third } : {}), losesData: false },
      add_reference: { action: "add column", table: table!, target: `${second}_id`, detail: "reference", losesData: false },
      remove_column: { action: "drop column", table: table!, target: second!, losesData: true },
      remove_reference: { action: "drop column", table: table!, target: `${second}_id`, losesData: true },
      rename_column: { action: "rename column", table: table!, target: second!, ...(third ? { detail: third } : {}), losesData: false },
      change_column: { action: "change column", table: table!, target: second!, ...(third ? { detail: `type ${third}` } : {}), losesData: true },
      drop_table: { action: "drop table", table: table!, losesData: true },
      rename_table: { action: "rename table", table: table!, ...(second ? { detail: second } : {}), losesData: false },
      add_index: { action: "add index", table: table!, ...(second ? { detail: second } : {}), losesData: false },
      remove_index: { action: "drop index", table: table!, ...(second ? { detail: second } : {}), losesData: false },
    };
    changes.push(action[verb!]!);
  }
  flush();
  return changes;
};

const djangoChanges = (text: string): ReadonlyArray<SchemaChange> => {
  const changes: Array<SchemaChange> = [];
  const operations = forward(text).split(/migrations\.(?=[A-Z]\w+\()/).slice(1);
  for (const operation of operations) {
    const kind = /^(\w+)\(/.exec(operation)![1]!;
    // by its own name, never inside another (name in model_name)
    const argument = (name: string) => new RegExp(`(?:^|[^\\w])${name}\\s*=\\s*['"]([^'"]+)['"]`).exec(operation)?.[1] ?? "";
    const field = /field\s*=\s*models\.(\w+)/.exec(operation)?.[1];
    const model = (argument("model_name") || argument("name")).toLowerCase();
    if (kind === "CreateModel") {
      const columns = [...operation.matchAll(/\(\s*['"](\w+)['"]\s*,\s*models\./g)].map((found) => found[1]!);
      changes.push({ action: "create table", table: argument("name").toLowerCase(), detail: columns.join(", "), losesData: false });
    } else if (kind === "DeleteModel") changes.push({ action: "drop table", table: model, losesData: true });
    else if (kind === "AddField") changes.push({ action: "add column", table: model, target: argument("name"), ...(field ? { detail: field } : {}), losesData: false });
    else if (kind === "RemoveField") changes.push({ action: "drop column", table: model, target: argument("name"), losesData: true });
    else if (kind === "AlterField") changes.push({ action: "change column", table: model, target: argument("name"), ...(field ? { detail: `type ${field}` } : {}), losesData: true });
    else if (kind === "RenameField") changes.push({ action: "rename column", table: model, target: argument("old_name"), detail: argument("new_name"), losesData: false });
    else if (kind === "RenameModel") changes.push({ action: "rename table", table: argument("old_name").toLowerCase(), detail: argument("new_name").toLowerCase(), losesData: false });
    else if (kind === "AddIndex") changes.push({ action: "add index", table: model, losesData: false });
    else if (kind === "RunSQL") changes.push(...sqlChanges(/['"]{3}([\s\S]*?)['"]{3}|['"]([^'"]*)['"]/.exec(operation)?.slice(1).find(Boolean) ?? ""));
    else changes.push({ action: kind.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase(), table: model, losesData: false });
  }
  return changes;
};

const laravelChanges = (text: string): ReadonlyArray<SchemaChange> => {
  const changes: Array<SchemaChange> = [];
  const up = forward(text);
  for (const block of up.split(/Schema::/).slice(1)) {
    const head = /^(create|table|drop|dropIfExists|rename)\(\s*['"](\w+)['"](?:\s*,\s*['"](\w+)['"])?/.exec(block);
    if (!head) continue;
    const [, verb, table, other] = head;
    if (verb === "drop" || verb === "dropIfExists") {
      changes.push({ action: "drop table", table: table!, losesData: true });
      continue;
    }
    if (verb === "rename") {
      changes.push({ action: "rename table", table: table!, ...(other ? { detail: other } : {}), losesData: false });
      continue;
    }
    const columns = [...block.matchAll(/\$table->(\w+)\(\s*(?:\[?['"](\w+)['"])?(?:\s*,\s*['"](\w+)['"])?/g)].map((found) => ({ type: found[1]!, name: found[2], to: found[3] }));
    if (verb === "create") {
      const names = columns.flatMap((column) => (column.type === "timestamps" ? ["created_at", "updated_at"] : column.type === "id" ? ["id"] : column.name ? [column.name] : []));
      changes.push({ action: "create table", table: table!, detail: names.join(", "), losesData: false });
      continue;
    }
    for (const column of columns) {
      if (column.type === "dropColumn") changes.push({ action: "drop column", table: table!, ...(column.name ? { target: column.name } : {}), losesData: true });
      else if (column.type === "renameColumn") changes.push({ action: "rename column", table: table!, ...(column.name ? { target: column.name } : {}), ...(column.to ? { detail: column.to } : {}), losesData: false });
      else if (column.type === "index" || column.type === "unique") changes.push({ action: column.type === "unique" ? "add unique index" : "add index", table: table!, ...(column.name ? { detail: column.name } : {}), losesData: false });
      else if (column.type === "dropIndex") changes.push({ action: "drop index", table: table!, ...(column.name ? { target: column.name } : {}), losesData: false });
      else if (column.name) changes.push({ action: "add column", table: table!, target: column.name, detail: column.type, losesData: false });
    }
  }
  return changes;
};

/** What a migration does to the schema, as it reads now; null when it is not of a kind collagen reads. */
export const schemaChanges = (file: string, text: ReadonlyArray<string>): ReadonlyArray<SchemaChange> | null => {
  const whole = text.join("\n");
  if (file.endsWith(".sql")) return sqlChanges(whole);
  if (file.endsWith(".rb")) return railsChanges(whole);
  if (file.endsWith(".py") && /migrations\.\w+\(/.test(whole)) return djangoChanges(whole);
  if (file.endsWith(".py") && /\bop\.execute\(/.test(whole)) return sqlChanges([...whole.matchAll(/op\.execute\(\s*['"]{1,3}([\s\S]*?)['"]{1,3}\s*\)/g)].map((found) => found[1]!).join(";"));
  if (file.endsWith(".php")) return laravelChanges(whole);
  return null;
};
