import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BEHAVIORS_RELATIVE_PATH, DESIGNS_RELATIVE_PATH, readArtifact } from "@/server/read-artifact";
import { writeArtifact } from "@/server/write-artifact";

const checkoutBehavior = {
  id: "checkout",
  title: "Checkout workflow",
  generator: "freeform",
  layout: { id: "elk-layered" },
  graph: {
    groups: [],
    nodes: [{ id: "checkout-page", type: "default", kind: "component", title: "Checkout page" }],
    edges: [],
  },
} as const;

async function createScope(): Promise<string> {
  return mkdtemp(join(tmpdir(), "architecture-companion-read-artifact-"));
}

describe("split artifact reading", () => {
  it("returns a valid empty artifact when both diagram directories are empty", async () => {
    const scopePath = await createScope();

    try {
      await writeArtifact(scopePath, { behaviors: [], designs: [] });

      expect(await readArtifact(scopePath)).toEqual({ status: "valid", artifact: { behaviors: [], designs: [] } });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("reports a missing artifact until a diagram directory exists", async () => {
    const scopePath = await createScope();

    try {
      await mkdir(join(scopePath, ".architecture-companion", "diagram-generators"), { recursive: true });
      expect(await readArtifact(scopePath)).toEqual({ status: "missing" });

      await mkdir(join(scopePath, BEHAVIORS_RELATIVE_PATH), { recursive: true });
      expect(await readArtifact(scopePath)).toEqual({ status: "valid", artifact: { behaviors: [], designs: [] } });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("treats one missing diagram directory as an empty collection", async () => {
    const scopePath = await createScope();

    try {
      await writeArtifact(scopePath, { behaviors: [checkoutBehavior], designs: [] });
      await rm(join(scopePath, DESIGNS_RELATIVE_PATH), { recursive: true });

      await expect(readArtifact(scopePath)).resolves.toMatchObject({
        status: "valid",
        artifact: { behaviors: [{ id: "checkout" }] },
      });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("allows the same diagram ID across behaviors and designs", async () => {
    const scopePath = await createScope();

    try {
      await writeArtifact(scopePath, {
        behaviors: [checkoutBehavior],
        designs: [{ ...checkoutBehavior, title: "Checkout structure" }],
      });

      await expect(readArtifact(scopePath)).resolves.toMatchObject({
        status: "valid",
        artifact: { behaviors: [{ id: "checkout" }], designs: [{ id: "checkout" }] },
      });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("sorts each collection by diagram file name", async () => {
    const scopePath = await createScope();

    try {
      await writeArtifact(scopePath, { behaviors: [], designs: [] });
      const designDirectory = join(scopePath, DESIGNS_RELATIVE_PATH);
      const diagram = (id: string, title: string) => ({ ...checkoutBehavior, id, title });
      await Promise.all(
        ["zoom-sync", "alpha-sync"].map((id) =>
          writeFile(join(designDirectory, `${id}.json`), JSON.stringify(diagram(id, id))),
        ),
      );

      await expect(readArtifact(scopePath)).resolves.toMatchObject({
        status: "valid",
        artifact: { designs: [{ id: "alpha-sync" }, { id: "zoom-sync" }] },
      });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("reports unexpected entries, invalid JSON, and file name mismatches together", async () => {
    const scopePath = await createScope();

    try {
      await mkdir(join(scopePath, BEHAVIORS_RELATIVE_PATH), { recursive: true });
      const behaviorDirectory = join(scopePath, BEHAVIORS_RELATIVE_PATH);
      await writeFile(join(behaviorDirectory, "README.md"), "not a diagram");
      await writeFile(join(behaviorDirectory, "checkout.json"), "{ partial");
      await writeFile(join(behaviorDirectory, "renamed.json"), JSON.stringify(checkoutBehavior));

      await expect(readArtifact(scopePath)).resolves.toMatchObject({
        status: "invalid",
        message: [
          "Unexpected artifact entry: .architecture-companion/behaviors/README.md",
          "Artifact contains invalid JSON: .architecture-companion/behaviors/checkout.json",
          "Diagram file name does not match the diagram ID: .architecture-companion/behaviors/renamed.json must be checkout.json",
        ].join("; "),
      });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });
});
