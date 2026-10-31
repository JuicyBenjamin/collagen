import { isRoomId, parseInvite, type Invite, type Net } from "@collagen/p2p";
import { NET } from "../app/net";

export type InviteCheck = { readonly ok: true; readonly invite: Invite } | { readonly ok: false; readonly reason: string };

/** Is this pasted text an invite this run can act on? Not an invite at all,
 *  an old one (a bare room id), or an invite for the other net, comes back
 *  with the sentence to show — the same one in the TUI and in the join-room tool. */
export function checkInvite(text: string, net: Net = NET): InviteCheck {
  const bare = text.trim().replace(/^devnet-/, "");
  if (isRoomId(bare)) return { ok: false, reason: "that is an old invite: a room's id no longer lets anyone in — ask a member for a new one (c in the room)" };
  const invite = parseInvite(text);
  if (invite === null) return { ok: false, reason: "that doesn't look like a room invite — ask a member to copy one with c in the room, and paste it whole" };
  if (invite.net !== net) {
    return {
      ok: false,
      reason:
        invite.net === "devnet"
          ? "that invite is for a devnet room, made by collagen running from source; this is the installed app, on mainnet, which cannot reach it — run from source to join"
          : "that invite is for a mainnet room; this run is from source, on devnet, and cannot reach it — join with the installed collagen",
    };
  }
  return { ok: true, invite };
}
