import type { Net } from "@collagen/p2p";
import { IS_RELEASE } from "./version";

/** The net this run is on. A release is on mainnet; a run from source (pnpm
 *  dev, tsx, the e2e harness) is on devnet. Everything that would let the two
 *  collide hangs off this one fact: the config dir, the swarm topic salt, the
 *  MCP server name and port. See the development guide, "Mainnet and devnet". */
export const NET: Net = IS_RELEASE ? "mainnet" : "devnet";
