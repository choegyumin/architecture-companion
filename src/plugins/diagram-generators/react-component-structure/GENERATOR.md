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
- `micromatch` applies generation-time file-path and component title/identity glob exclusions.
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
- `--exclude-component <glob>`: optional and repeatable component-title or stable component-ID exclusion. For example, `external:@base-ui/react#*` hides every boundary from that package without hiding same-named local wrappers.

Tests, declaration files, generated files, dependency directories, and common build-output directories are excluded from analysis by default. Explicit file and component globs are applied after the selected local source is analyzed. Both selectors use the same transparent collapse: a matching component boundary and the implementation-created components beneath it are omitted, while statically confirmed values supplied by its parent pass through to the nearest visible owner. For example, filtering `Layout` from `App → Layout → Content` produces `App → Content`; `Layout` and components created inside `Layout` do not remain in the graph candidate. Hidden elements are never written to the output JSON. Generation fails if filtering leaves no visible local component because the current `Diagram.graph` schema requires at least one node.

## Output contract

Successful execution creates an untracked operating-system temporary directory and prints its absolute graph-file path followed by a newline. That file contains only a strict graph candidate:

```json
{
  "groups": [],
  "nodes": [],
  "edges": []
}
```

React component nodes omit `kind` because every node in this graph has the same category. External boundaries remain identifiable through their package-boundary descriptions. Named local components use `component:<scope-relative-file>#<name>` identities. Anonymous default expressions use the independent `#default` identity while retaining a file-derived display title.

It never writes an Architecture Companion artifact. Read the existing diagram files first, read this temporary graph, then decide how to preserve or revise the existing diagram. Preserve unrelated diagrams and stable IDs for unchanged concepts. Set `generatorId` to `react-component-structure` when this generator is used to create or regenerate a diagram, then validate the complete artifact through the Architecture Companion validation flow.

## Relationship contract

The analyzer emits only statically confirmed relationships:

- direct render: no visible relationship label;
- node prop, including `children`: kind `NODE (<renderer prop name>)`, label `from <supplier>`;
- render prop: kind `RENDER (<invoker prop name>)`, label `from <supplier>`;
- component prop: kind `COMPONENT (<renderer prop name>)`, label `from <supplier>`.

For supplied values, the visual parent is the confirmed local renderer or invoker. The label names the component definition that created the supplied target. Confirmed local prop forwarding is followed through named aliases and static prop bags, so the kind uses the final visible renderer's case-preserved prop name while the label retains the original supplier. When several component definitions supply the same target through one semantic relationship, their names are sorted and combined in one label instead of duplicating the edge.

External components use the same boundary/implementation visibility model as filtered local components: the external boundary remains visible and connected, while the package implementation is opaque and never expanded. An explicitly component-filtered external boundary is collapsed like any other hidden boundary. Statically visible local values supplied through node props, render props, component props, and component registries remain connected. Event-style `onX` callback results are omitted at external boundaries because their return values are not confirmed as rendered.

The initial identity model is one node per component definition. Unresolved references are omitted without routine warnings. Provider annotations, per-use nodes, other UI frameworks, runtime reconstruction, and change-impact analysis are not implemented.
