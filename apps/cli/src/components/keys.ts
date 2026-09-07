import { appendFileSync } from "node:fs";

export interface Key {
  name: string;
  sequence: string;
}

/** The kitty keyboard protocol names it "enter", the legacy parser "return". */
export function isEnter(key: Key): boolean {
  return key.name === "return" || key.name === "enter" || key.name === "linefeed" || key.sequence === "\r" || key.sequence === "\n";
}

export function isSpace(key: Key): boolean {
  return key.name === "space" || key.sequence === " ";
}

/** Appends key events to COLLAGEN_LOG's sibling key log when set — so "this
 *  key does nothing" reports come back with data instead of guesses. */
export function keyDebug(where: string, key: Key, extra?: string): void {
  const base = process.env.COLLAGEN_LOG;
  if (!base) return;
  try {
    appendFileSync(
      base + ".keys",
      `${new Date().toISOString()} ${where} name=${JSON.stringify(key.name)} seq=${JSON.stringify(key.sequence)}${extra ? " " + extra : ""}\n`,
    );
  } catch {
    // best-effort
  }
}
