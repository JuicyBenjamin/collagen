// Every commit is a release-notes line (release-please) — so every commit is
// a conventional commit. Types: the conventional set. Scopes: the packages and
// the few non-package areas, so `feat(cli):` and `fix(p2p):` read as labels.
// A subject may start with a capital where it names something on screen
// ("Refresh shows an icon", "Accept says what it does"); Title Case and
// shouting are still refused.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [2, "always", ["cli", "p2p", "review-web", "docs", "e2e", "deps", "release", "main", "ci"]],
    "subject-case": [2, "never", ["start-case", "pascal-case", "upper-case"]],
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
