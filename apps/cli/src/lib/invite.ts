import { parseInvite, type Net } from "@collagen/p2p";
import { NET } from "../app/net";

export type InviteCheck = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly reason: string };

/** Is this pasted text an invite this run can act on? Not an invite at all,
 *  or an invite for the other net, comes back with the sentence to show —
 *  the same one in the TUI and in the join-room tool. */
export function checkInvite(text: string, net: Net = NET): InviteCheck {
  const parsed = parseInvite(text);
  if (parsed === null) {
    return { ok: false, reason: "that doesn't look like a room invite — it should be a uuid like 019904c3-…-…, with a devnet- prefix when it comes from a run from source" };
  }
  if (parsed.net !== net) {
    return {
      ok: false,
      reason:
        parsed.net === "devnet"
          ? "that invite is for a devnet room, made by collagen running from source; this is the installed app, on mainnet, which cannot reach it — run from source to join"
          : "that invite is for a mainnet room; this run is from source, on devnet, and cannot reach it — join with the installed collagen",
    };
  }
  return { ok: true, id: parsed.id };
}
