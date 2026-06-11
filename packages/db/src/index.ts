/**
 * @collagen/db — Prisma Next data layer.
 * Schema lives in src/prisma/contract.ts (TS-native `defineContract`).
 * Run `pnpm contract:emit` after editing it to regenerate the typed contract.
 */
export { db } from "./prisma/db";
export type { Contract } from "./prisma/contract.d";
