import { useEffect } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Effect, Stream } from "effect";
import { AsyncResult } from "effect/reactivity";
import { Places } from "../services/Places";
import { to, useRouter } from "./router";
import { runtimeAtom } from "./runtime";

/** The place the person's agent last asked to take them to (open-settings). */
const placeAtom = runtimeAtom.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      return (yield* Places).follow;
    }),
  ),
);

/** Goes where the person's agent asks to take them, while the terminal is
 *  open: the global settings come back to where the person was. */
export function FollowPlaces() {
  const { route, navigate } = useRouter();
  const place = AsyncResult.getOrElse(useAtomValue(placeAtom), () => null);
  useEffect(() => {
    if (!place) return;
    // from the global settings already, back stays where it was before them
    const back = typeof route === "object" && route.name === "settings/global" ? route.back : route;
    navigate(place.to === "settings" ? to.settings(place.tab) : to.globalSettings(back, place.tab));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- each ask once, told from the last by its time
  }, [place?.at]);
  return null;
}
