import { createEffect, Show } from "solid-js";
import { Arrives } from "~/components/Arrives";
import { Masked } from "~/components/Masked";
import { hostNow } from "~/hostNow";
import { kept } from "~/kept";
import { ticketId } from "~/ticket";

/** Whose name stood there last time, for its placeholder's width. */
const lastName = kept(
  `collagen.viewer.v1.${ticketId}`,
  (value): value is string => typeof value === "string",
);

/** Who is signed in to the review's host — whose name a review goes out
 *  under. With no host to ask, or nobody signed in, the face's place stays,
 *  empty, and says why. Waits on the host. */
export function Viewer() {
  createEffect(
    () => hostNow.host(),
    (host) => {
      if (host)
        lastName.keep(
          host.viewer ? (host.viewer.name ?? host.viewer.login) : `Not signed in to ${host.host}`,
        );
    },
  );
  const nobody = (label: string, title: string | undefined) => (
    <span class="viewer nobody" title={title}>
      <span class="avatar empty" aria-hidden="true" />
      <span class="host-note">{label}</span>
    </span>
  );
  const notConnected = () => {
    const current = hostNow.view();
    return current && "none" in current ? current.none : undefined;
  };
  return (
    <Arrives inline skeleton={Viewer.Skeleton} ready={hostNow.view() !== null}>
      <Show when={hostNow.host()} fallback={nobody("Not connected", notConnected())}>
        {(host) => (
          <Show
            when={host().viewer}
            fallback={nobody(`Not signed in to ${host().host}`, host().signIn)}
          >
            {(me) => (
              <span
                class="viewer"
                title={`Signed in to ${host().host} as ${me().login} — a review or comment sent from here goes out under this name`}
              >
                <Show when={me().avatarUrl}>
                  {(src) => (
                    <img
                      class="avatar"
                      src={src()}
                      alt=""
                      onError={(event) => (event.currentTarget.style.visibility = "hidden")}
                      width={22}
                      height={22}
                    />
                  )}
                </Show>
                <span class="viewer-name">{me().name ?? me().login}</span>
              </span>
            )}
          </Show>
        )}
      </Show>
    </Arrives>
  );
}

/** A face's place and a name as wide as the last one. */
Viewer.Skeleton = function Skeleton() {
  return (
    <span class="sk viewer" aria-hidden="true">
      <span class="avatar sk-avatar" />
      <Masked>{lastName.last ?? "Your name"}</Masked>
    </span>
  );
};
