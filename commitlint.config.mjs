// Every commit is a release-notes line (release-please) — so every commit is
// a conventional commit. Types: the conventional set. Scopes: the packages and
// the few non-package areas, so `feat(cli):` and `fix(p2p):` read as labels.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [2, "always", ["cli", "p2p", "docs", "e2e", "deps", "release", "main", "ci"]],
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
