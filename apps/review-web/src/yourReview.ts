import type { HostView, YourReview } from "./data";

type Host = Extract<HostView, { readonly host: string }>;

/** The reader's own finish of a review, the latest of two: the room's (their
 *  take, or their close — `room`) and the host's (their last review on the
 *  pull request). Each is whole from its own read: its verdict, its time,
 *  and whether the change moved after it, by that read's own head. A review
 *  the host dismissed no longer stands. How many comments they said: the
 *  room's count or the host's, whichever knows more (one said on both is
 *  counted on each, not twice). */
export const yourReview = (room: YourReview | undefined, host: Host | null): YourReview | null => {
  const login = host?.viewer?.login;
  const given = login ? host.reviews.filter((review) => review.author.login === login && Number.isFinite(Date.parse(review.at))) : [];
  const last = given.reduce<(typeof given)[number] | undefined>((latest, review) => (!latest || Date.parse(review.at) >= Date.parse(latest.at) ? review : latest), undefined);
  const onHost: YourReview | null =
    last && last.verdict !== "dismissed"
      ? { as: last.verdict, at: Date.parse(last.at), since: last.commit !== undefined && host?.pull?.head !== undefined && last.commit !== host.pull.head }
      : null;
  const finish = ((): YourReview | null => {
    if (!room) return onHost;
    if (!onHost) return room;
    // a finish from the page is both, a moment apart: the room cannot see a
    // push, so the host's word on one counts whichever is later
    const latest = onHost.at > room.at ? onHost : room;
    return { ...latest, since: room.since || onHost.since };
  })();
  if (!finish) return null;
  const comments = Math.max(room?.comments ?? 0, login ? host.comments.filter((comment) => comment.author.login === login).length : 0);
  return comments > 0 ? { ...finish, comments } : finish;
};
