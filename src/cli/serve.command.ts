import { resolveConsumerScope } from "@/server/resolve-consumer-scope";
import { type StartedServer, startServer } from "@/server/start-server";

export type ServeCommandOptions = Readonly<{
  staticRoot?: string | false;
  writeStdout: (output: string) => void;
}>;

export async function executeServeCommand(
  args: readonly string[],
  options: ServeCommandOptions,
): Promise<StartedServer> {
  const scopeInput = args.at(0);
  if (args.length !== 1 || scopeInput === undefined) throw new Error("Usage: node serve.js <scope>");

  const scope = await resolveConsumerScope(scopeInput);
  const serverOptions =
    options.staticRoot === undefined
      ? { hostname: "127.0.0.1", port: 0 }
      : { hostname: "127.0.0.1", port: 0, staticRoot: options.staticRoot };
  const server = await startServer(scope, serverOptions);

  try {
    options.writeStdout(`${server.url}\n`);
    return server;
  } catch (error) {
    await server.close();
    throw error;
  }
}
