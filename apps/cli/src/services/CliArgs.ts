import { Context, Layer, Option } from "effect";

/** Parsed CLI flags, provided by the entrypoint before the app layer builds. */
export class CliArgs extends Context.Service<CliArgs, {
  readonly profile: string;
  readonly name: Option.Option<string>;
  readonly room: Option.Option<string>;
}>()("cli/CliArgs") {}

export const cliArgsLayer = (args: { profile: string; name: Option.Option<string>; room: Option.Option<string> }) =>
  Layer.succeed(CliArgs, args);
