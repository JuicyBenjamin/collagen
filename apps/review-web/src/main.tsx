import { render } from "@solidjs/web";
import { createThemeBaseCss, createThemeRule } from "@tanstack/highlight/theme";
import { githubLightTheme } from "@tanstack/highlight/themes/github-light";
import { oneDarkProTheme } from "@tanstack/highlight/themes/one-dark-pro";
import { App } from "./App";
import { MergesApp, mergesRoom } from "./Merges";
import { BoardApp, onBoard } from "./components/Board";
import { startHandoff } from "./handoff";
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

// one document for three pages: /review/<ticketId>, /merges/<roomId> and a room's board at /board/<room>
const room = mergesRoom;
const board = onBoard();
if (room === null && !board) startHandoff();
render(() => (board ? <BoardApp /> : room === null ? <App /> : <MergesApp roomId={room} />), document.getElementById("root")!);
