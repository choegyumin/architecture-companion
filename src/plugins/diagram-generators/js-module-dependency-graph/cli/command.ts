import { parseArgs } from "node:util";

import type { JsModuleDependencyGraphOptions } from "./generator";

export type GenerateJsModuleDependencyGraphCommandEnvironment = Readonly<{
  writeGraph: (options: JsModuleDependencyGraphOptions) => Promise<string>;
  writeStdout: (output: string) => void;
}>;

const usage =
  "Usage: js-module-dependency-graph --base <directory> [--tsconfig <path>] [--exclude-path <glob> ...] <source-path>...";

export async function executeGenerateJsModuleDependencyGraphCommand(
  args: readonly string[],
  environment: GenerateJsModuleDependencyGraphCommandEnvironment,
): Promise<void> {
  const { positionals, values } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      base: { type: "string" },
      "exclude-path": { type: "string", multiple: true },
      tsconfig: { type: "string" },
    },
    strict: true,
  });

  if (!values.base || positionals.length === 0) throw new Error(usage);

  const graphPath = await environment.writeGraph({
    scopePath: values.base,
    sourcePaths: positionals,
    ...(values["exclude-path"] ? { exclude: values["exclude-path"] } : {}),
    ...(values.tsconfig ? { tsConfigPath: values.tsconfig } : {}),
  });
  environment.writeStdout(`${JSON.stringify({ graphPath })}\n`);
}
