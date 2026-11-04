// Every commit is a release-notes line (release-please) — so every commit is
// a conventional commit. Types: the conventional set. Scopes: the packages,
// the few non-package areas, and the parts of the app a person knows by name
// (the review page, the TUI, the board, the agent's tools, steering), so
// `feat(cli):` and `fix(review):` read as labels.
// A subject may start with a capital where it names something on screen
// ("Refresh shows an icon", "Accept says what it does"); Title Case and
// shouting are still refused.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [2, "always", ["cli", "p2p", "review-web", "docs", "e2e", "deps", "release", "main", "ci", "review", "tui", "board", "mcp", "steering"]],
    "subject-case": [2, "never", ["start-case", "pascal-case", "upper-case"]],
    // a subject says what a person now finds, in a sentence: room for one, still not a paragraph
    "header-max-length": [2, "always", 140],
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
