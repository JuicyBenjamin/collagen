import noShorthandNames from "./no-shorthand-names.mjs";

// collagen's own lint rules on how code is named (oxlint jsPlugins).
export default {
  meta: { name: "naming" },
  rules: { "no-shorthand-names": noShorthandNames },
};
