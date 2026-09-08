// The build (tsup) defines __COLLAGEN_VERSION__ from package.json; running
// from source (pnpm dev, tsx) has no build step, so it reads "dev".
declare const __COLLAGEN_VERSION__: string | undefined;

export const VERSION: string = typeof __COLLAGEN_VERSION__ === "string" ? __COLLAGEN_VERSION__ : "dev";
