import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { BEHAVIORS_RELATIVE_PATH, DESIGNS_RELATIVE_PATH } from "@/server/read-artifact";

type WritableDiagram = Readonly<{
  id: string;
  [key: string]: unknown;
}>;
type WritableDiagramCollection = readonly WritableDiagram[];

export type WritableArtifact = Readonly<{
  behaviors: WritableDiagramCollection;
  designs: WritableDiagramCollection;
}>;

const artifactKinds = [
  { relativePath: BEHAVIORS_RELATIVE_PATH, diagrams: "behaviors" },
  { relativePath: DESIGNS_RELATIVE_PATH, diagrams: "designs" },
] as const;

async function writeDiagramFile(scopePath: string, relativePath: string, diagram: WritableDiagram): Promise<void> {
  const directoryPath = join(scopePath, relativePath);
  const fileName = `${diagram.id}.json`;
  const temporaryPath = join(directoryPath, `.${diagram.id}-${randomUUID()}.tmp`);

  try {
    await writeFile(temporaryPath, JSON.stringify(diagram), { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, join(directoryPath, fileName));
  } catch (error) {
    try {
      await rm(temporaryPath, { force: true });
    } catch {
      // The temporary file may not exist or may already have been renamed.
    }
    throw error;
  }
}

export async function writeArtifact(scopePath: string, artifact: WritableArtifact): Promise<void> {
  for (const { relativePath, diagrams } of artifactKinds) {
    const directoryPath = join(scopePath, relativePath);
    await mkdir(directoryPath, { recursive: true });

    const nextFileNames = new Set(artifact[diagrams].map(({ id }) => `${id}.json`));
    const previousEntries = await readdir(directoryPath).catch((error) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [] as string[];
      throw error;
    });
    await Promise.all(
      previousEntries
        .filter((entry) => entry.endsWith(".json") && !nextFileNames.has(entry))
        .map((entry) => rm(join(directoryPath, entry), { force: true })),
    );

    await Promise.all(artifact[diagrams].map((diagram) => writeDiagramFile(scopePath, relativePath, diagram)));
  }
}
