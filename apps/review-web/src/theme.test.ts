import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { themesFromBrowser } from "./theme";
import { checkedThemes, customCss, generatorPayload, parseTheme, themeFromGenerator } from "./themeData";

describe("a theme pasted as CSS", () => {
  it("reads daisyUI's theme generator's CSS: its variables and its scheme", () => {
    const read = parseTheme(`@plugin "daisyui/theme" {
  name: "mine";
  default: true;
  prefersdark: false;
  color-scheme: "dark";
  --color-base-100: oklch(25% 0.02 260);
  --color-primary: oklch(70% 0.2 280);
  --radius-box: 0.5rem;
  --depth: 1;
}`);
    expect(read).toEqual({
      scheme: "dark",
      vars: { "--color-base-100": "oklch(25% 0.02 260)", "--color-primary": "oklch(70% 0.2 280)", "--radius-box": "0.5rem", "--depth": "1" },
    });
  });

  it("keeps only theme variables, and nothing that could leave its rule", () => {
    const read = parseTheme(`[data-theme="x"] { --color-primary: red; --font: serif; --color-error: red} body { x: y }</style><script>; }`);
    expect(read?.vars).toEqual({ "--color-primary": "red", "--color-error": "red" });
    expect(read?.scheme).toBe("light");
    expect(parseTheme("body { color: red; }")).toBeNull();
  });

  it("is shown under data-theme=custom, and reads back as it was", () => {
    const theme = { scheme: "dark" as const, vars: { "--color-base-100": "#101010", "--border": "1px" } };
    expect(parseTheme(customCss(theme))).toEqual(theme);
  });
});

describe("a theme from a daisyUI theme generator link", () => {
  // as the generator packs it: its theme as JSON, deflated, base64url, after #theme=
  const link = (theme: object) => `https://daisyui.com/theme-generator/#theme=${deflateSync(JSON.stringify(theme)).toString("base64url")}`;

  it("is found in the link, and read for its variables and scheme alone", () => {
    const given = link({ name: "light", "color-scheme": "dark", "--color-primary": "oklch(28% 0.141 291.089)", "--radius-box": "2rem", default: false, prefersdark: false });
    const payload = generatorPayload(given);
    expect(payload).not.toBeNull();
    const json: unknown = JSON.parse(inflateSync(Buffer.from(payload!, "base64url")).toString("utf8"));
    expect(themeFromGenerator(json)).toEqual({ scheme: "dark", vars: { "--color-primary": "oklch(28% 0.141 291.089)", "--radius-box": "2rem" } });
    expect(generatorPayload("https://daisyui.com/components/button/")).toBeNull();
    expect(themeFromGenerator({ "--color-primary": "red} body{x:y" })).toBeNull();
  });
});

describe("the person's own themes, as kept", () => {
  it("drops one that is damaged or could leave its rule, keeps the rest, and the choice only if it exists", () => {
    const kept = checkedThemes({
      chosen: "custom:b2",
      saved: [
        { id: "a1", name: "Calm", scheme: "light", vars: { "--color-primary": "#123456" } },
        { id: "b2", name: "Broken", scheme: "light" },
        { id: "c3", name: "Sneaky", scheme: "dark", vars: { "--color-primary": "red} body{display:none" } },
        { id: "../x", name: "Bad id", scheme: "light", vars: { "--color-primary": "#000000" } },
      ],
    });
    expect(kept.saved.map((theme) => theme.name)).toEqual(["Calm"]);
    expect(kept.chosen).toBe("");
  });

  it('brings an older page\'s one custom theme, chosen, over as "My theme"', () => {
    const one = JSON.stringify({ scheme: "dark", vars: { "--color-primary": "#ff0000" } });
    expect(themesFromBrowser(null, "custom", null, one)).toEqual({ chosen: "custom:mine", saved: [{ id: "mine", name: "My theme", scheme: "dark", vars: { "--color-primary": "#ff0000" } }] });
    expect(themesFromBrowser(null, null, null, null)).toEqual({ chosen: "", saved: [] });
  });
});
