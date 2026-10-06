import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AnnotationCanvasController } from "@/client/parts/annotation-layer";
import { installComponentDiagramBrowserMeasurements } from "@/client/widgets/component-structure-test-browser";
import { DiagramRenderer } from "@/client/widgets/diagram-renderer";
import { parseArtifact } from "@/features/artifact/artifact";
import { projectDecisionNodes } from "@/features/diagram/decision-nodes";
import { buildComponentGraph } from "@/plugins/artifact-generators/react-component-structure/analysis/build-component-graph";

import { waitForDiagramReady } from "../tests/helpers/wait-for-diagram";

const annotations: AnnotationCanvasController = {
  document: { annotations: [] },
  surface: { canvasId: "components" },
  isCommentMode: false,
  isManaging: false,
  isPublishing: false,
  begin: () => {},
  change: () => {},
  changeEdit: () => {},
  cancel: async () => true,
  closeEdit: async () => true,
  move: async () => {},
  open: () => {},
  publish: async () => {},
  removeEdit: async () => {},
  resolveEditConflict: async () => {},
  saveEdit: async () => true,
};

it("keeps supplied conditional paths operable after generating and serializing the graph", async () => {
  const scopePath = await mkdtemp(join(tmpdir(), "component-renderer-integration-"));
  const restoreBrowserMeasurements = installComponentDiagramBrowserMeasurements();
  try {
    await mkdir(join(scopePath, "node_modules"));
    await symlink(
      dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
      join(scopePath, "node_modules", "typescript"),
      "dir",
    );
    await writeFile(
      join(scopePath, "components.tsx"),
      `
      function Leaf() { return <span />; }
      function Shell({ children, enabled }) { return <>{enabled && children}</>; }
      function App({ open }) { return open && <Shell><Leaf /></Shell>; }
    `,
    );
    const graph = await buildComponentGraph({ scopePath, sourcePaths: ["components.tsx"], rootPatterns: ["App"] });
    const diagram = parseArtifact(
      JSON.parse(
        JSON.stringify({
          id: "generated-components",
          title: "Generated components",
          updatedAt: "2026-10-04T09:00:00.000Z",
          generator: "built-in:react-component-structure",
          instructions: "Regenerate from components.tsx.",
          layout: { id: "elk-layered" },
          graph,
        }),
      ),
    );
    const user = userEvent.setup();
    render(<DiagramRenderer annotations={annotations} diagram={diagram} onOpenSource={() => {}} />);
    await waitForDiagramReady();
    expect(screen.getByRole("article", { name: /\bLeaf$/ })).toHaveAccessibleDescription(/\binactive\b/i);

    const consumerSwitch = await screen.findByRole("switch", { name: "enabled" });
    expect(consumerSwitch).not.toBeDisabled();
    await user.click(consumerSwitch);
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "open" })).toHaveAttribute("aria-checked", "true");
      expect(screen.getByRole("switch", { name: "enabled" })).toHaveAttribute("aria-checked", "true");
      expect(screen.getByRole("article", { name: /Leaf$/ })).toHaveAccessibleDescription(/^active /i);
    });
    expect(screen.getByText(/App.*children/)).toBeVisible();
  } finally {
    cleanup();
    restoreBrowserMeasurements();
    await rm(scopePath, { recursive: true, force: true });
  }
});

it("honors control prerequisites when an authored edge contains only its local requirement", async () => {
  const restoreBrowserMeasurements = installComponentDiagramBrowserMeasurements();
  try {
    const diagram = parseArtifact({
      id: "nested-metadata",
      title: "Nested metadata",
      updatedAt: "2026-10-04T09:00:00.000Z",
      generator: "built-in:react-component-structure",
      instructions: "Review nested rendering prerequisites.",
      layout: { id: "elk-layered" },
      graph: projectDecisionNodes({
        groups: [],
        nodes: [
          { id: "app", type: "default", title: "App" },
          { id: "leaf", type: "default", title: "Leaf" },
        ],
        edges: [
          {
            id: "app-leaf",
            type: "default",
            source: "app",
            target: "leaf",
            activeWhen: [[{ controlId: "child", value: "on" }]],
          },
        ],
        roots: ["app"],
        controls: [
          { id: "parent", owner: "app", kind: "conditional", label: "parent", dependsOn: [[]] },
          {
            id: "child",
            owner: "app",
            kind: "conditional",
            label: "child",
            dependsOn: [[{ controlId: "parent", value: "on" }]],
          },
        ],
      }),
    });
    const user = userEvent.setup();
    render(<DiagramRenderer annotations={annotations} diagram={diagram} onOpenSource={() => {}} />);
    await waitForDiagramReady();
    await user.click(screen.getByRole("switch", { name: "child" }));
    expect(screen.getByRole("article", { name: "Leaf" })).toHaveAccessibleDescription(/^active /i);
    await user.click(screen.getByRole("switch", { name: "parent" }));

    // The parent switch turns off alone: field controls are individual, and
    // the child's value only stops mattering because its path went dark.
    expect(screen.getByRole("switch", { name: "child" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("article", { name: "Leaf" })).toHaveAccessibleDescription(/^inactive /i);
  } finally {
    cleanup();
    restoreBrowserMeasurements();
  }
});

it("does not activate a shared consumer's output through an inactive supplier's retained local selection", async () => {
  const restoreBrowserMeasurements = installComponentDiagramBrowserMeasurements();
  try {
    const diagram = parseArtifact({
      id: "supplier-metadata",
      title: "Supplier metadata",
      updatedAt: "2026-10-04T09:00:00.000Z",
      generator: "built-in:react-component-structure",
      instructions: "Review conditional supplied output through a shared consumer.",
      layout: { id: "elk-layered" },
      graph: projectDecisionNodes({
        groups: [],
        nodes: ["App", "Supplier", "Shared", "Leaf"].map((title) => ({ id: title, type: "default", title })),
        edges: [
          {
            id: "supplier",
            type: "default",
            source: "App",
            target: "Supplier",
            activeWhen: [[{ controlId: "supplier-visible", value: "on" }]],
          },
          { id: "direct-shared", type: "default", source: "App", target: "Shared" },
          { id: "supplied-shared", type: "default", source: "Supplier", target: "Shared" },
          {
            id: "shared-leaf",
            type: "default",
            source: "Shared",
            target: "Leaf",
            activeWhen: [[{ controlId: "leaf", value: "on" }]],
          },
        ],
        roots: ["App"],
        controls: [
          { id: "supplier-visible", owner: "App", kind: "conditional", label: "supplier visible", dependsOn: [[]] },
          { id: "leaf", owner: "Supplier", kind: "conditional", label: "leaf", dependsOn: [[]] },
        ],
      }),
    });
    const user = userEvent.setup();
    render(<DiagramRenderer annotations={annotations} diagram={diagram} onOpenSource={() => {}} />);
    await waitForDiagramReady();
    await user.click(screen.getByRole("switch", { name: "leaf" }));
    expect(screen.getByRole("article", { name: "Leaf" })).toHaveAccessibleDescription(/^active /i);
    await user.click(screen.getByRole("switch", { name: "supplier visible" }));

    expect(screen.getByRole("switch", { name: "leaf" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("article", { name: "Supplier" })).toHaveAccessibleDescription(/^inactive /i);
    expect(screen.getByRole("article", { name: "Shared" })).toHaveAccessibleDescription(/^active /i);
    expect(screen.getByRole("article", { name: "Leaf" })).toHaveAccessibleDescription(/^inactive /i);
  } finally {
    cleanup();
    restoreBrowserMeasurements();
  }
});
