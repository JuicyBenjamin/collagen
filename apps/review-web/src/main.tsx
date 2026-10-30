import { render } from "@solidjs/web";
import { createThemeBaseCss, createThemeRule } from "@tanstack/highlight/theme";
import { githubLightTheme } from "@tanstack/highlight/themes/github-light";
import { oneDarkProTheme } from "@tanstack/highlight/themes/one-dark-pro";
import { App } from "./App";
import { MergesApp, mergesPlace, MergesRoom } from "./Merges";
import { Investigation, investigationPlace } from "./components/Investigation";
import { startHandoff } from "./handoff";
import { themeNow } from "./themeNow";
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
// every page wears the theme chosen, and follows it as it changes
themeNow.start();

// one document for every page: /review/<ticketId>, /investigation/<ticketId>,
// /merges/<roomId>/<project>, and a room's /merges/<roomId>, which goes on
// to a project's
const merges = mergesPlace;
const investigation = investigationPlace;
if (merges === null && investigation === null) startHandoff();
render(
  () =>
    investigation !== null ? (
      <Investigation ticketId={investigation} />
    ) : merges === null ? (
      <App />
    ) : merges.project === null ? (
      <MergesRoom roomId={merges.room} />
    ) : (
      <MergesApp roomId={merges.room} project={merges.project} />
    ),
  document.getElementById("root")!,
);
