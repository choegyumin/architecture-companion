import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeViewCatalogCommand } from "@/cli/view-catalog.command";
import { writeCatalog } from "@/server/write-catalog";

let scopePath: string;
let output: string;
const options = {
  writeStdout: (text: string) => {
    output += text;
  },
};

beforeEach(async () => {
  scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-view-catalog-"));
  output = "";
});

afterEach(async () => {
  await rm(scopePath, { recursive: true, force: true });
});

it("prints null when there is no catalog", async () => {
  await executeViewCatalogCommand([scopePath], options);
  expect(output).toBe("null\n");
});

it("prints discovered artifact paths and content as one JSON line", async () => {
  const artifact = {
    id: "src/checkout.archcomp.json",
    kind: "behavior",
    title: "Checkout",
    updatedAt: "2026-10-03T09:15:00.000Z",
    generator: "built-in:freeform",
    instructions: "Review checkout behavior.",
    diagram: {
      layout: { id: "elk-layered" },
      graph: { groups: [], nodes: [{ id: "checkout", type: "default", title: "Checkout" }], edges: [] },
    },
  };
  await writeCatalog(scopePath, { behaviors: [artifact], designs: [] });
  await executeViewCatalogCommand([scopePath], options);
  expect(output.split("\n")).toHaveLength(2);
  expect(JSON.parse(output)).toEqual({ behaviors: [artifact], designs: [] });
});

it("rejects invalid artifacts without printing a misleading empty catalog", async () => {
  await writeCatalog(scopePath, {
    behaviors: [{ id: ".architecture-companion/artifacts/invalid.archcomp.json", title: "Incomplete" }],
    designs: [],
  });
  await expect(executeViewCatalogCommand([scopePath], options)).rejects.toThrow("Catalog is invalid");
  expect(output).toBe("");
});

it("requires exactly one scope argument", async () => {
  await expect(executeViewCatalogCommand([], options)).rejects.toThrow("Usage: node view-catalog.js <scope>");
});
