import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ARTIFACTS_RELATIVE_PATH, readCatalog } from "@/server/read-catalog";

const checkoutBehavior = {
  kind: "behavior",
  title: "Checkout workflow",
  updatedAt: "2026-10-03T09:15:00.000Z",
  generator: "built-in:freeform",
  instructions: "## Purpose\nReview the checkout entry point.\n\n## Regeneration\nRebuild the checkout page boundary.",
  diagram: {
    layout: { layoutId: "elk-layered" },
    graph: {
      groups: [],
      nodes: [{ nodeId: "checkout-page", type: "default", kind: "component", title: "Checkout page" }],
      edges: [],
    },
  },
} as const;

let scopePath: string;

beforeEach(async () => {
  scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-read-catalog-"));
});

afterEach(async () => {
  await rm(scopePath, { recursive: true, force: true });
});

async function save(relativePath: string, input: unknown = checkoutBehavior): Promise<void> {
  const filePath = join(scopePath, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(input));
}

describe("catalog reading", () => {
  it("discovers co-located artifacts with the default glob without creating configuration", async () => {
    await save("src/checkout.archcomp.json");
    expect(await readCatalog(scopePath)).toEqual({
      status: "valid",
      catalog: { behaviors: [{ ...checkoutBehavior, artifactId: "src/checkout.archcomp.json" }], designs: [] },
    });
  });

  it("respects gitignore while always discovering central artifacts", async () => {
    await writeFile(
      join(scopePath, ".gitignore"),
      ".architecture-companion/\nignored/\n*.archcomp.json\n!visible.archcomp.json\n",
    );
    await save("visible.archcomp.json");
    await save("ignored/hidden.archcomp.json");
    await save("src/hidden.archcomp.json");
    await save(`${ARTIFACTS_RELATIVE_PATH}/nested/central.json`, { ...checkoutBehavior, kind: "design" });
    expect(await readCatalog(scopePath)).toMatchObject({
      status: "valid",
      catalog: {
        behaviors: [{ artifactId: "visible.archcomp.json" }],
        designs: [{ artifactId: `${ARTIFACTS_RELATIVE_PATH}/nested/central.json` }],
      },
    });
  });

  it("uses configured glob patterns instead of forcing the default suffix, without duplicating central matches", async () => {
    await save(".architecture-companion/config.json", {
      artifactPatterns: ["src/**/*.review.json", ".architecture-companion/artifacts/**/*.json", "!src/excluded/**"],
      placementInstructions: "Prefer central artifacts for new diagrams.",
    });
    await save("src/checkout.review.json");
    await save("src/excluded/hidden.review.json");
    await save("src/not-selected.archcomp.json");
    await save(`${ARTIFACTS_RELATIVE_PATH}/central.json`, { ...checkoutBehavior, kind: "design" });
    expect(await readCatalog(scopePath)).toMatchObject({
      status: "valid",
      catalog: {
        behaviors: [{ artifactId: "src/checkout.review.json" }],
        designs: [{ artifactId: `${ARTIFACTS_RELATIVE_PATH}/central.json` }],
      },
    });
  });

  it("applies nested gitignore rules and negations relative to their directory", async () => {
    await writeFile(join(scopePath, ".gitignore"), "hidden.archcomp.json\n");
    await save("src/hidden.archcomp.json");
    await save("src/ignored.archcomp.json");
    await save("src/visible.archcomp.json");
    await writeFile(join(scopePath, "src/.gitignore"), "!hidden.archcomp.json\nignored.archcomp.json\n");
    expect(await readCatalog(scopePath)).toMatchObject({
      status: "valid",
      catalog: { behaviors: [{ artifactId: "src/hidden.archcomp.json" }, { artifactId: "src/visible.archcomp.json" }] },
    });
  });

  it("keeps central artifacts visible when configured patterns are empty", async () => {
    await save(".architecture-companion/config.json", { artifactPatterns: [] });
    await save("src/hidden.archcomp.json");
    await save(`${ARTIFACTS_RELATIVE_PATH}/central.json`);
    expect(await readCatalog(scopePath)).toMatchObject({
      status: "valid",
      catalog: { behaviors: [{ artifactId: `${ARTIFACTS_RELATIVE_PATH}/central.json` }] },
    });
  });

  it.each(["{ partial", JSON.stringify({ artifactPatterns: "*.json" }), JSON.stringify({ unknown: true })])(
    "reports invalid configuration instead of silently using defaults: %s",
    async (content) => {
      await mkdir(join(scopePath, ".architecture-companion"), { recursive: true });
      await writeFile(join(scopePath, ".architecture-companion/config.json"), content);
      expect(await readCatalog(scopePath)).toMatchObject({
        status: "invalid",
        message: expect.stringContaining("Catalog configuration is invalid"),
      });
    },
  );

  it("returns a valid empty catalog when the central artifact directory exists", async () => {
    await mkdir(join(scopePath, ARTIFACTS_RELATIVE_PATH), { recursive: true });
    expect(await readCatalog(scopePath)).toEqual({ status: "valid", catalog: { behaviors: [], designs: [] } });
  });

  it("reports missing when no central directory or matching artifact exists", async () => {
    await mkdir(join(scopePath, ".architecture-companion/artifact-generators"), { recursive: true });
    expect(await readCatalog(scopePath)).toEqual({ status: "missing" });
  });

  it("identifies an artifact by its path without restricting its filename", async () => {
    const path = `${ARTIFACTS_RELATIVE_PATH}/Checkout overview.json`;
    await save(path);
    expect(await readCatalog(scopePath)).toEqual({
      status: "valid",
      catalog: { behaviors: [{ ...checkoutBehavior, artifactId: path }], designs: [] },
    });
  });

  it("groups artifacts by their kind in one central directory", async () => {
    await save(`${ARTIFACTS_RELATIVE_PATH}/workflow.json`);
    await save(`${ARTIFACTS_RELATIVE_PATH}/structure.json`, { ...checkoutBehavior, kind: "design" });
    expect(await readCatalog(scopePath)).toMatchObject({
      status: "valid",
      catalog: {
        behaviors: [{ artifactId: `${ARTIFACTS_RELATIVE_PATH}/workflow.json`, kind: "behavior" }],
        designs: [{ artifactId: `${ARTIFACTS_RELATIVE_PATH}/structure.json`, kind: "design" }],
      },
    });
  });

  it("sorts each collection by artifact path", async () => {
    await save(`${ARTIFACTS_RELATIVE_PATH}/zoom.json`);
    await save(`${ARTIFACTS_RELATIVE_PATH}/alpha.json`);
    expect(await readCatalog(scopePath)).toMatchObject({
      status: "valid",
      catalog: {
        behaviors: [
          { artifactId: `${ARTIFACTS_RELATIVE_PATH}/alpha.json` },
          { artifactId: `${ARTIFACTS_RELATIVE_PATH}/zoom.json` },
        ],
      },
    });
  });

  it("ignores non-artifact entries in the central directory", async () => {
    await mkdir(join(scopePath, ARTIFACTS_RELATIVE_PATH), { recursive: true });
    await writeFile(join(scopePath, ARTIFACTS_RELATIVE_PATH, "README.md"), "not an artifact");
    expect(await readCatalog(scopePath)).toEqual({ status: "valid", catalog: { behaviors: [], designs: [] } });
  });

  it("reports invalid JSON and invalid artifact data with their paths", async () => {
    await save(`${ARTIFACTS_RELATIVE_PATH}/bad-kind.json`, { ...checkoutBehavior, kind: "other" });
    await writeFile(join(scopePath, ARTIFACTS_RELATIVE_PATH, "bad-json.json"), "{ partial");
    const result = await readCatalog(scopePath);
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") throw new Error("Expected invalid catalog");
    expect(result.message).toContain(`Catalog contains invalid JSON: ${ARTIFACTS_RELATIVE_PATH}/bad-json.json`);
    expect(result.message).toContain(`Catalog is invalid: ${ARTIFACTS_RELATIVE_PATH}/bad-kind.json`);
  });
});
