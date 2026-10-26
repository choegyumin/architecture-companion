import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeViewArtifactsCommand } from "@/cli/view-artifacts.command";

import { writeCatalog } from "../../tests/helpers/write-catalog";

let scopePath: string;
let output: string;
const options = {
  writeStdout: (text: string) => {
    output += text;
  },
};

beforeEach(async () => {
  scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-view-artifacts-"));
  output = "";
});

afterEach(async () => {
  await rm(scopePath, { recursive: true, force: true });
});

it("prints null when there is no catalog", async () => {
  await executeViewArtifactsCommand([scopePath], options);
  expect(output).toBe("null\n");
});

it("prints discovered artifact paths and content as one JSON line", async () => {
  const artifact = {
    artifactId: "src/checkout.archcomp.json",
    type: "behavior",
    title: "Checkout",
    updatedAt: "2026-10-03T09:15:00.000Z",
    generator: "built-in:freeform",
    instructions: "Review checkout behavior.",
    diagram: {
      layout: { layoutId: "general" },
      graph: {
        groups: [],
        nodes: [{ nodeId: "checkout", type: "default", title: "Checkout", synthetic: false }],
        edges: [],
      },
    },
  };
  await writeCatalog(scopePath, { artifacts: [artifact] });
  await executeViewArtifactsCommand([scopePath], options);
  expect(output.split("\n")).toHaveLength(2);
  expect(JSON.parse(output)).toEqual({ artifacts: [artifact] });
});

it("rejects invalid artifacts without printing a misleading empty catalog", async () => {
  await writeCatalog(scopePath, {
    artifacts: [{ artifactId: ".architecture-companion/artifacts/invalid.archcomp.json", title: "Incomplete" }],
  });
  await expect(executeViewArtifactsCommand([scopePath], options)).rejects.toThrow("Catalog is invalid");
  expect(output).toBe("");
});

it("requires exactly one scope argument", async () => {
  await expect(executeViewArtifactsCommand([], options)).rejects.toThrow("Usage: node view-artifacts.js <scope>");
});
