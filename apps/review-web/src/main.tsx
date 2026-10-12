import { render } from "@solidjs/web";
import { createThemeBaseCss, createThemeRule } from "@tanstack/highlight/theme";
import { githubLightTheme } from "@tanstack/highlight/themes/github-light";
import { oneDarkProTheme } from "@tanstack/highlight/themes/one-dark-pro";
import { App } from "./App";
import { MergesApp, mergesRoom } from "./Merges";
import { startHandoff } from "./handoff";
import { applyTheme, cachedThemes } from "./theme";
import "./themes.css";
import "./styles.css";

// Token colours from TanStack Highlight's themes: GitHub Light, One Dark Pro
// when the page is dark — the theme chosen says which (data-scheme, theme.ts),
// or, with none, the system. CSS only — the markup is the same in both.
const theme = document.createElement("style");
theme.textContent = [
  createThemeBaseCss(),
  createThemeRule(":root", githubLightTheme),
  `@media (prefers-color-scheme: dark) {\n${createThemeRule(":root:not([data-scheme])", oneDarkProTheme)}\n}`,
  createThemeRule(':root[data-scheme="dark"]', oneDarkProTheme),
].join("\n");
document.head.append(theme);
applyTheme(cachedThemes());

// one document for both pages: /review/<ticketId>, and /merges/<roomId>
const room = mergesRoom;
if (room === null) startHandoff();
render(() => (room === null ? <App /> : <MergesApp roomId={room} />), document.getElementById("root")!);
