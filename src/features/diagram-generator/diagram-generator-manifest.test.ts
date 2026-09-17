import { parseDiagramGeneratorManifest } from "@/features/diagram-generator/diagram-generator-manifest";

describe("diagram generator manifest parsing", () => {
  it("parses the required metadata and the prompt", () => {
    const source = `---
id: dependency-graph
description: Builds a dependency graph from source files.
---

Inspect source files and produce an artifact.
`;

    expect(parseDiagramGeneratorManifest(source)).toEqual({
      id: "dependency-graph",
      description: "Builds a dependency graph from source files.",
      prompt: "Inspect source files and produce an artifact.",
    });
  });

  it("preserves CRLF line endings and colons inside the description", () => {
    const source = [
      "---",
      "id: request-flow",
      "description: Traces requests: client to server.",
      "---",
      "",
      "Trace each request.",
    ].join("\r\n");

    expect(parseDiagramGeneratorManifest(source)).toEqual({
      id: "request-flow",
      description: "Traces requests: client to server.",
      prompt: "Trace each request.",
    });
  });

  it.each([
    ["an unknown key", "id: dependency-graph\ndescription: Builds a graph.\nversion: 1"],
    ["a duplicate key", "id: dependency-graph\nid: another-graph\ndescription: Builds a graph."],
  ])("rejects %s", (_name, frontmatter) => {
    const source = `---\n${frontmatter}\n---\n\nBuild the diagram.`;

    expect(() => parseDiagramGeneratorManifest(source)).toThrow("Invalid diagram generator manifest");
  });

  it.each([
    ["a missing opening delimiter", "id: dependency-graph\ndescription: Builds a graph.\n---\nBuild the diagram."],
    ["a missing closing delimiter", "---\nid: dependency-graph\ndescription: Builds a graph.\nBuild the diagram."],
    ["a missing id", "---\ndescription: Builds a graph.\n---\nBuild the diagram."],
    ["a missing description", "---\nid: dependency-graph\n---\nBuild the diagram."],
    ["an empty prompt", "---\nid: dependency-graph\ndescription: Builds a graph.\n---\n"],
  ])("rejects %s", (_name, source) => {
    expect(() => parseDiagramGeneratorManifest(source)).toThrow("Invalid diagram generator manifest");
  });

  it.each([
    ["an invalid id", "id: Dependency_Graph\ndescription: Builds a graph."],
    ["an empty description", "id: dependency-graph\ndescription:   "],
    ["a malformed line", "id dependency-graph\ndescription: Builds a graph."],
    ["a multiline description", "id: dependency-graph\ndescription: Builds a graph.\n  From source files."],
  ])("rejects %s", (_name, frontmatter) => {
    const source = `---\n${frontmatter}\n---\nBuild the diagram.`;

    expect(() => parseDiagramGeneratorManifest(source)).toThrow("Invalid diagram generator manifest");
  });
});
