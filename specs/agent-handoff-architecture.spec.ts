import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { executeServeCommand } from "@/cli/serve.command";
import { executeValidateSchemasCommand } from "@/cli/validate-schemas.command";
import { executeViewGeneratorsCommand } from "@/cli/view-generators.command";
import type { StartedServer } from "@/server/start-server";

const spawnProcess = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("Architecture Companion must not launch a child process during server startup.");
  }),
);

vi.mock("node:child_process", async (importOriginal) => {
  const childProcess = await importOriginal<typeof import("node:child_process")>();
  return { ...childProcess, spawn: spawnProcess };
});

async function getJson(url: string): Promise<Readonly<{ status: number | undefined; body: unknown }>> {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      let chunks: readonly Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        chunks = [...chunks, chunk];
      });
      response.once("error", reject);
      response.once("end", () => {
        try {
          resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once("error", reject);
  });
}

async function writeGenerator(
  rootPath: string,
  directoryName: string,
  id: string,
  description: string,
): Promise<string> {
  const pluginPath = join(rootPath, directoryName);
  await mkdir(pluginPath, { recursive: true });
  await writeFile(
    join(pluginPath, "GENERATOR.md"),
    `---\nid: ${id}\ndescription: ${description}\n---\n\nGenerate an Architecture Companion artifact.\n`,
  );
  return pluginPath;
}

function reviewArtifact(generatorId: string) {
  return {
    behaviors: [
      {
        id: "checkout",
        title: "Checkout workflow",
        generatorId,
        layout: { id: "elk-layered" },
        graph: {
          groups: [],
          nodes: [{ id: "checkout-page", type: "default", kind: "component", title: "Checkout page" }],
          edges: [],
        },
      },
    ],
    designs: [],
  };
}

describe("coding agent hands off a validated artifact as a review URL", () => {
  it("resolves generators, validates the artifact, and serves a review URL for the scope", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "architecture-companion-skill-"));
    const scopePath = join(temporaryRoot, "scope");
    const homeDirectory = join(temporaryRoot, "home");
    const builtInGeneratorsRoot = resolve("src/plugins/diagram-generators");
    let generatorOutputs: readonly string[] = [];
    let validationOutputs: readonly string[] = [];
    let serverOutputs: readonly string[] = [];
    let server: StartedServer | undefined;

    try {
      await mkdir(scopePath);
      const globalPlugin = await writeGenerator(
        join(homeDirectory, ".architecture-companion", "diagram-generators"),
        "request-flow",
        "request-flow",
        "Traces request flow.",
      );
      const projectPlugin = await writeGenerator(
        join(scopePath, ".architecture-companion", "diagram-generators"),
        "dependency-graph",
        "dependency-graph",
        "Builds a dependency graph.",
      );

      await executeViewGeneratorsCommand([scopePath], {
        builtInGeneratorsRoot,
        homeDirectory,
        writeStdout: (output) => {
          generatorOutputs = [...generatorOutputs, output];
        },
      });

      expect(generatorOutputs).toHaveLength(1);
      expect(JSON.parse(generatorOutputs.at(0) as string)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "dependency-graph", source: "project", path: await realpath(projectPlugin) }),
          expect.objectContaining({
            id: "freeform",
            source: "built-in",
            path: resolve(builtInGeneratorsRoot, "freeform"),
          }),
          expect.objectContaining({ id: "request-flow", source: "global", path: resolve(globalPlugin) }),
        ]),
      );

      const artifactDirectory = join(scopePath, ".architecture-companion");
      const artifactPath = join(artifactDirectory, "artifact.json");
      const collectValidationOutput = (output: string) => {
        validationOutputs = [...validationOutputs, output];
      };

      await expect(
        executeValidateSchemasCommand([scopePath], { writeStdout: collectValidationOutput }),
      ).rejects.toThrow("Artifact is missing: .architecture-companion/artifact.json");

      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(artifactPath, JSON.stringify(reviewArtifact("Invalid_ID")));
      await expect(
        executeValidateSchemasCommand([scopePath], { writeStdout: collectValidationOutput }),
      ).rejects.toThrow("Artifact is invalid");

      await writeFile(artifactPath, JSON.stringify(reviewArtifact("dependency-graph")));
      await executeValidateSchemasCommand([scopePath], { writeStdout: collectValidationOutput });
      expect(validationOutputs).toEqual(["Artifact is valid.\n"]);

      server = await executeServeCommand([scopePath], {
        staticRoot: false,
        writeStdout: (output) => {
          serverOutputs = [...serverOutputs, output];
        },
      });

      const reviewResponse = await getJson(`${server.url}/api/review`);
      expect(reviewResponse.status).toBe(200);
      expect(reviewResponse.body).toMatchObject({
        artifact: { behaviors: [{ generatorId: "dependency-graph" }] },
      });
      expect(serverOutputs).toEqual([`${server.url}\n`]);
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(spawnProcess).not.toHaveBeenCalled();
    } finally {
      await server?.close();
      await rm(temporaryRoot, { recursive: true });
    }
  }, 30_000);
});
