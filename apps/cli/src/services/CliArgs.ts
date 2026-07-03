import { Context, Layer, Option } from "effect";

/** Parsed CLI flags, provided by the entrypoint before the app layer builds. */
export class CliArgs extends Context.Tag("cli/CliArgs")<
  CliArgs,
  {
    readonly profile: string;
    readonly name: Option.Option<string>;
  }
>() {}

export const cliArgsLayer = (args: { profile: string; name: Option.Option<string> }) =>
  Layer.succeed(CliArgs, args);
