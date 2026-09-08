// release-please versioning strategy "labelled": plain semver bumps with a
// constant pre-release label. feat → 0.2.0-alpha, fix → 0.1.1-alpha,
// breaking → 0.2.0-alpha while pre-1.0 (release-please's pre-major rules) —
// never 0.1.0-alpha.1. The label comes from `prerelease-type` in the config;
// change it to "beta" to graduate, drop `versioning` to release for real.
import { DefaultVersioningStrategy } from "release-please/build/src/versioning-strategies/default.js";
import { Version } from "release-please/build/src/version.js";

export const labelled = (options) => {
  const inner = new DefaultVersioningStrategy(options);
  const label = options.prereleaseType;
  return {
    determineReleaseType: (version, commits) => inner.determineReleaseType(version, commits),
    bump(version, commits) {
      // bump the bare number, then re-attach the label
      const bare = new Version(version.major, version.minor, version.patch, undefined, version.build);
      const next = inner.bump(bare, commits);
      return new Version(next.major, next.minor, next.patch, label, next.build);
    },
  };
};
