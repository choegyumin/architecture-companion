import { parseArgs } from "node:util";

import type { JsModuleDependencyGraphOptions } from "@/features/js-module-dependency-graph/js-module-dependency-graph";

export type GenerateJsModuleDependencyGraphCommandEnvironment = Readonly<{
  writeGraph: (options: JsModuleDependencyGraphOptions) => Promise<string>;
  writeStdout: (output: string) => void;
}>;

const usage = "Usage: node generate.js --scope <scope> [--ts-config <path>] [--exclude <glob> ...] <source-path>...";

export async function executeGenerateJsModuleDependencyGraphCommand(
  args: readonly string[],
  environment: GenerateJsModuleDependencyGraphCommandEnvironment,
): Promise<void> {
  const { positionals, values } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      exclude: { type: "string", multiple: true },
      scope: { type: "string" },
      "ts-config": { type: "string" },
    },
    strict: true,
  });

  if (!values.scope || positionals.length === 0) throw new Error(usage);

  const graphPath = await environment.writeGraph({
    scopePath: values.scope,
    sourcePaths: positionals,
    ...(values.exclude ? { exclude: values.exclude } : {}),
    ...(values["ts-config"] ? { tsConfigPath: values["ts-config"] } : {}),
  });
  environment.writeStdout(`${JSON.stringify({ graphPath })}\n`);
}
