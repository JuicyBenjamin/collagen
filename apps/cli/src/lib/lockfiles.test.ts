import { describe, expect, it } from "vitest";
import { isLockfile, packageChanges } from "./lockfiles";

const lines = (text: string) => text.split("\n");

describe("a lockfile read as the packages its change moves", () => {
  it("is known by its name, in any folder", () => {
    expect(["pnpm-lock.yaml", "apps/web/package-lock.json", "yarn.lock", "Cargo.lock", "Gemfile.lock", "src/lock.ts", "pnpm-lock.yml"].map(isLockfile)).toEqual([true, true, true, true, true, false, false]);
  });

  it("reads pnpm's packages, scoped and with peers, and says what moved", () => {
    const before = lines("lockfileVersion: '9.0'\n\npackages:\n\n  '@scope/kit@1.0.0':\n    resolution: {}\n\n  left-pad@1.3.0:\n    resolution: {}\n\nsnapshots:\n\n  '@scope/kit@1.0.0(react@18.0.0)':\n    dependencies: {}");
    const after = lines("lockfileVersion: '9.0'\n\npackages:\n\n  '@scope/kit@1.1.0':\n    resolution: {}\n\n  is-even@1.0.0:\n    resolution: {}\n\nsnapshots:\n\n  '@scope/kit@1.1.0(react@18.0.0)':\n    dependencies: {}");
    expect(packageChanges("pnpm-lock.yaml", after, before)).toEqual([
      { name: "@scope/kit", before: ["1.0.0"], after: ["1.1.0"] },
      { name: "is-even", before: [], after: ["1.0.0"] },
      { name: "left-pad", before: ["1.3.0"], after: [] },
    ]);
  });

  it("reads npm's, yarn's and cargo's the same way", () => {
    const npm = (version: string) => lines(JSON.stringify({ packages: { "": {}, "node_modules/a": { version: "1.0.0" }, "node_modules/a/node_modules/b": { version } } }));
    expect(packageChanges("package-lock.json", npm("2.0.0"), npm("1.0.0"))).toEqual([{ name: "b", before: ["1.0.0"], after: ["2.0.0"] }]);
    const yarn = (version: string) => lines(`"@x/y@^1.0.0", "@x/y@^1.2.0":\n  version "${version}"\n  resolved "…"`);
    expect(packageChanges("yarn.lock", yarn("1.2.3"), yarn("1.2.0"))).toEqual([{ name: "@x/y", before: ["1.2.0"], after: ["1.2.3"] }]);
    const cargo = (version: string) => lines(`[[package]]\nname = "serde"\nversion = "${version}"`);
    expect(packageChanges("Cargo.lock", cargo("1.0.1"), null)).toEqual([{ name: "serde", before: [], after: ["1.0.1"] }]);
  });

  it("reads nothing of a format it does not know, rather than say nothing moved", () => {
    expect(packageChanges("Gemfile.lock", lines("GEM"), lines("GEM"))).toBe(null);
  });
});
