import { Effect } from "effect";
import { IdentityService } from "../../services/Identity";
import { runtimeAtom } from "../../app/runtime";

// Only the You page changes this.

/** Change your display name now — peers see it on the next profile broadcast. */
export const setMyNameAtom = runtimeAtom.fn(
  Effect.fnUntraced(function* ({ name }: { name: string }) {
    const ident = yield* IdentityService;
    yield* ident.setName(name);
  }),
);
