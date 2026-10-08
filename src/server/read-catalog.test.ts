import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BEHAVIORS_RELATIVE_PATH, DESIGNS_RELATIVE_PATH, readCatalog } from "@/server/read-catalog";
import { writeCatalog } from "@/server/write-catalog";

const checkoutBehavior = {
  id: "checkout",
  title: "Checkout workflow",
  updatedAt: "2026-10-03T09:15:00.000Z",
  generator: "built-in:freeform",
  instructions: "## Purpose\nReview the checkout entry point.\n\n## Regeneration\nRebuild the checkout page boundary.",
  diagram: {
    layout: { id: "elk-layered" },
    graph: {
      groups: [],
      nodes: [{ id: "checkout-page", type: "default", kind: "component", title: "Checkout page" }],
      edges: [],
    },
  },
} as const;

async function createScope(): Promise<string> {
  return mkdtemp(join(tmpdir(), "architecture-companion-read-catalog-"));
}

describe("split catalog reading", () => {
  it("returns a valid empty catalog when both diagram directories are empty", async () => {
    const scopePath = await createScope();

    try {
      await writeCatalog(scopePath, { behaviors: [], designs: [] });

      expect(await readCatalog(scopePath)).toEqual({ status: "valid", catalog: { behaviors: [], designs: [] } });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("reports a missing catalog until a diagram directory exists", async () => {
    const scopePath = await createScope();

    try {
      await mkdir(join(scopePath, ".architecture-companion", "artifact-generators"), { recursive: true });
      expect(await readCatalog(scopePath)).toEqual({ status: "missing" });

      await mkdir(join(scopePath, BEHAVIORS_RELATIVE_PATH), { recursive: true });
      expect(await readCatalog(scopePath)).toEqual({ status: "valid", catalog: { behaviors: [], designs: [] } });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("treats one missing diagram directory as an empty collection", async () => {
    const scopePath = await createScope();

    try {
      await writeCatalog(scopePath, { behaviors: [checkoutBehavior], designs: [] });
      await rm(join(scopePath, DESIGNS_RELATIVE_PATH), { recursive: true });

      await expect(readCatalog(scopePath)).resolves.toMatchObject({
        status: "valid",
        catalog: { behaviors: [{ id: "checkout" }] },
      });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("allows the same diagram ID across behaviors and designs", async () => {
    const scopePath = await createScope();

    try {
      const catalog = {
        behaviors: [checkoutBehavior],
        designs: [
          {
            ...checkoutBehavior,
            title: "Checkout structure",
            vcs: { revision: "r1842", divergesFromRevision: true },
          },
        ],
      };
      await writeCatalog(scopePath, catalog);

      await expect(readCatalog(scopePath)).resolves.toEqual({ status: "valid", catalog });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("sorts each collection by diagram file name", async () => {
    const scopePath = await createScope();

    try {
      await writeCatalog(scopePath, { behaviors: [], designs: [] });
      const designDirectory = join(scopePath, DESIGNS_RELATIVE_PATH);
      const diagram = (id: string, title: string) => ({ ...checkoutBehavior, id, title });
      await Promise.all(
        ["zoom-sync", "alpha-sync"].map((id) =>
          writeFile(join(designDirectory, `${id}.json`), JSON.stringify(diagram(id, id))),
        ),
      );

      await expect(readCatalog(scopePath)).resolves.toMatchObject({
        status: "valid",
        catalog: { designs: [{ id: "alpha-sync" }, { id: "zoom-sync" }] },
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

      await expect(readCatalog(scopePath)).resolves.toMatchObject({
        status: "invalid",
        message: [
          "Unexpected catalog entry: .architecture-companion/behaviors/README.md",
          "Catalog contains invalid JSON: .architecture-companion/behaviors/checkout.json",
          "Artifact file name does not match the artifact ID: .architecture-companion/behaviors/renamed.json must be checkout.json",
        ].join("; "),
      });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });
});
