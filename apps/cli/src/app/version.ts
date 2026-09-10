import { readFileSync } from "node:fs";

// The build (tsup) defines __COLLAGEN_VERSION__ from package.json; running
// from source (pnpm dev, tsx) has no build step.
declare const __COLLAGEN_VERSION__: string | undefined;

const built = typeof __COLLAGEN_VERSION__ === "string" ? __COLLAGEN_VERSION__ : null;

const fromPackage = (): string => {
  try {
    const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
    return version ?? "unknown";
  } catch {
    return "unknown";
  }
};

/** Whether this is a built artifact. The one thing that actually differs about
 *  a run from source — said as a boolean, not as a magic version string for
 *  everyone to compare against (`VERSION !== "dev"` was exactly that). */
export const IS_RELEASE: boolean = built !== null;

/** This build's version: the one tsup stamped in, or package.json's when
 *  running from source. Always a real version — an alpha should be able to say
 *  so wherever it introduces itself (see lib/versionLabel). */
export const VERSION: string = built ?? fromPackage();
