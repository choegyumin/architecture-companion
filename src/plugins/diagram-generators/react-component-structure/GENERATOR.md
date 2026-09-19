---
id: react-component-structure
description: Builds a React component structure graph from confirmed direct render, node prop, render prop, and component prop relationships.
---

# React Component Structure Diagram Generator

Use this generator for a source-level view of how React components in selected JS, JSX, TS, and TSX paths compose one another. The graph is not a reconstructed runtime render tree.

## Files and execution

The source checkout contains:

- `generator.ts`: importable analyzer seam that returns a `Diagram.graph` candidate;
- `command.ts`: argument parsing and temporary graph-file output seam;
- `cli/run.ts`: thin source-checkout executable;
- `generator.test.ts`: focused behavior tests.

The installed distribution contains this guide and the bundled `cli/run.js` executable. It does not require package installation in the consumer project.

## Analysis tools

- TypeScript Compiler API parses JS, JSX, TS, and TSX, creates the project `Program`, and supplies lexical symbols, alias resolution, and module resolution.
- `micromatch` applies generation-time file-path and component-name glob exclusions.
- The analyzer adds the four React relationship rules and supplied-value consumption analysis. It does not infer runtime behavior from types alone.

Run the executable adjacent to this guide. In an installed distribution:

```sh
node "<generator-path>/cli/run.js" \
  --scope "<absolute-consumer-scope>" \
  --source "src"
```

From this repository's source checkout:

```sh
pnpm exec tsx "<generator-path>/cli/run.ts" \
  --scope "<absolute-consumer-scope>" \
  --source "src"
```

Arguments are generator-specific:

- `--scope <directory>`: required explicit consumer scope used for source links and path containment;
- `--source <path>`: required and repeatable file or directory, absolute or relative to the scope;
- `--tsconfig <path>`: optional TypeScript configuration, absolute or relative to the scope; otherwise the nearest scope `tsconfig.json` is used;
- `--exclude-file <glob>`: optional and repeatable scope-relative file-path exclusion;
- `--exclude-component <glob>`: optional and repeatable component-title exclusion.

Tests, declaration files, generated files, dependency directories, and common build-output directories are excluded by default. Additional glob matches remove the matching node and its incident edges only. They do not remove unmatched descendants or create shortcut edges. Generation fails if filtering removes every local component because the current `Diagram.graph` schema requires at least one node.

## Output contract

Successful execution creates an untracked operating-system temporary directory and prints its absolute graph-file path followed by a newline. That file contains only a strict graph candidate:

```json
{
  "groups": [],
  "nodes": [],
  "edges": []
}
```

It never writes an Architecture Companion artifact. Read the existing diagram files first, read this temporary graph, then decide how to preserve or revise the existing diagram. Preserve unrelated diagrams and stable IDs for unchanged concepts. Set `generatorId` to `react-component-structure` when this generator is used to create or regenerate a diagram, then validate the complete artifact through the Architecture Companion validation flow.

## Relationship contract

The analyzer emits only statically confirmed relationships:

- direct render: no edge label;
- node prop, including `children`: `Node prop · <actual prop name>`;
- render prop: `Render prop · <actual prop name>`;
- component prop: `Component prop · <actual prop name>`.

For supplied values, the visual parent is the confirmed local renderer or invoker. Confirmed local prop forwarding is followed through named aliases and static prop bags to that consumer or to the external boundary where local evidence ends. The boundary remains connected to statically visible local values supplied through node props, render props, component props, and component registries; only the package's internal implementation stays opaque. Event-style `onX` callback results are omitted at external boundaries because their return values are not confirmed as rendered.

The initial identity model is one node per component definition. Unresolved references are omitted without routine warnings. Provider annotations, per-use nodes, other UI frameworks, runtime reconstruction, and change-impact analysis are not implemented.
