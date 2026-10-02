import { render } from "@solidjs/web";
import { createThemeBaseCss, createThemeRule } from "@tanstack/highlight/theme";
import { githubLightTheme } from "@tanstack/highlight/themes/github-light";
import { oneDarkProTheme } from "@tanstack/highlight/themes/one-dark-pro";
import { App } from "./App";
import "./styles.css";

// Token colours from TanStack Highlight's themes: GitHub Light, One Dark Pro
// when the system is dark. CSS only — the markup is the same in both.
const theme = document.createElement("style");
theme.textContent = [
  createThemeBaseCss(),
  createThemeRule(":root", githubLightTheme),
  `@media (prefers-color-scheme: dark) {\n${createThemeRule(":root", oneDarkProTheme)}\n}`,
].join("\n");
document.head.append(theme);

render(() => <App />, document.getElementById("root")!);
