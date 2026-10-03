import { describe, expect, it } from "vitest";
import { importsAmong, jsSpecifiers, phpUses } from "./imports";

describe("which changed files import which", () => {
  it("reads a JS/TS file's relative specifiers in every form", () => {
    const code = `import { a } from "./a";\nimport type { B } from '../b/index.js';\nexport { c } from "./c";\nimport "./side";\nconst d = await import("./d");\nconst e = require("./e");\nimport { pkg } from "effect";`;
    expect(jsSpecifiers(code)).toEqual(["./a", "../b/index.js", "./c", "./side", "./d", "./e"]);
  });

  it("links TS files to the changed files they name, .js specifiers and folders included", () => {
    const files = ["src/page.ts", "src/page.test.ts", "src/rows/index.ts", "src/util.ts", "README.md"];
    const text: Record<string, string> = {
      "src/page.ts": `import { rows } from "./rows";\nimport { x } from "./not-changed";`,
      "src/page.test.ts": `import { page } from "./page.js";`,
      "src/rows/index.ts": `export const rows = 1;`,
      "src/util.ts": `import { page } from "./page";`,
    };
    const got = importsAmong(files, (f) => text[f] ?? null);
    expect([...got.entries()].map(([f, to]) => `${f} -> ${[...to].join(",")}`)).toEqual(["src/page.ts -> src/rows/index.ts", "src/page.test.ts -> src/page.ts", "src/util.ts -> src/page.ts"]);
  });

  it("links PHP files by the classes they use, as a PSR-4 autoloader would find them", () => {
    expect(phpUses("<?php\nnamespace App\\Http;\nuse App\\Models\\User;\nuse function App\\helpers\\cells;\nuse Acme\\Greeter as G;\n")).toEqual(["App/Models/User", "App/helpers/cells", "Acme/Greeter"]);
    const files = ["app/Http/Controller.php", "app/Models/User.php"];
    const got = importsAmong(files, (f) => (f === "app/Http/Controller.php" ? "<?php\nuse App\\Models\\User;\n" : "<?php\n"));
    expect([...(got.get("app/Http/Controller.php") ?? [])]).toEqual(["app/Models/User.php"]);
  });
});
