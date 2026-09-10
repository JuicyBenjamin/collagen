/** The build, as a person reads it: "0.8.0-alpha" → "Alpha v0.8.0". The
 *  release stage leads, because that is the part that sets expectations — an
 *  alpha should say so wherever the app introduces itself, not only in the
 *  footer. A release with no stage is just its number. Whether the run came
 *  from source is a separate fact (`IS_RELEASE`), never encoded in here. */
export const versionLabel = (version: string): string => {
  if (version.length === 0 || version === "unknown") return "unknown";
  const [number, ...rest] = version.split("-");
  const stage = rest.join("-").split(".")[0] ?? "";
  const named = stage.length > 0 ? `${stage[0]!.toUpperCase()}${stage.slice(1)} ` : "";
  return `${named}v${number}`;
};
