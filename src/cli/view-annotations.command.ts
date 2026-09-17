import { createFileAnnotationRepository } from "@/server/file-annotation-repository";
import { readActiveRevisionAnnotations } from "@/server/read-active-revision-annotations";
import { resolveConsumerScopePath } from "@/server/resolve-consumer-scope";

export type ViewAnnotationsCommandOptions = Readonly<{
  writeStdout: (output: string) => void;
}>;

export async function executeViewAnnotationsCommand(
  args: readonly string[],
  options: ViewAnnotationsCommandOptions,
): Promise<void> {
  const scopeInput = args.at(0);
  if (args.length !== 1 || scopeInput === undefined) {
    throw new Error("Usage: node view-annotations.js <scope>");
  }

  const scopePath = await resolveConsumerScopePath(scopeInput);
  const result = await readActiveRevisionAnnotations(scopePath, createFileAnnotationRepository(scopePath));

  if (result.status === "invalid") throw new Error(result.message);
  options.writeStdout(`${JSON.stringify(result.revisionAnnotations)}\n`);
}
