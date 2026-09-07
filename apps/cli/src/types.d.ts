// @collagen/p2p is source-exported, so the cli's tsc compiles its files too and
// needs these ambient decls (Holepunch modules ship no types).
declare module "hyperswarm";
declare module "hypercore-crypto";
declare module "b4a";
declare module "hyperdht";
declare module "hyperdht/testnet.js";
declare module "corestore";
declare module "autobase";
declare module "hyperbee";
declare module "protomux";
declare module "compact-encoding";
