---
id: js-module-dependency-graph
description: Maps confirmed JavaScript and TypeScript module dependencies, directory and package groups, external package boundaries, and type-only edges.
---

# JavaScript Module Dependency Graph Generator

Use this generator when the review question asks which JavaScript or TypeScript source modules depend on each other or on external packages.

## Run the generator

The generator directory contains `generate.js` in an installed Architecture Companion distribution. Run it with the explicit review scope and one or more selected source paths:

```sh
node "<generator-directory>/generate.js" \
  --scope "<absolute-scope>" \
  [--ts-config "<scope-relative-tsconfig>"] \
  [--exclude "<glob>" ...] \
  <scope-relative-source-path>...
```

Source paths may name files or directories but must stay inside the scope. When `--ts-config` is omitted, the generator uses `<scope>/tsconfig.json` if it exists. Repeat `--exclude` for additional file-path globs. Globs use forward-slash scope-relative paths.

The generator always excludes test files, `__tests__`, common build output directories, `__generated__`, and `*.generated.*` or `*.gen.*` source files. A matching file node and its incident edges are removed. No descendant, synthetic shortcut edge, or unresolved dependency is inferred.

On success, stdout contains one JSON line:

```json
{ "graphPath": "/temporary/path/graph.json" }
```

The referenced file contains only a `Diagram.graph` candidate with `groups`, `nodes`, and `edges`. It is temporary and must not be copied into the repository as a standalone artifact.

## Interpret and adopt the graph

1. Read the existing per-diagram artifact before changing it.
2. Read the temporary graph candidate programmatically.
3. Preserve, revise, or replace the existing graph according to the review request. Preserve unrelated diagrams and stable IDs for unchanged concepts.
4. Keep local source modules as nodes, identified by their source files. Directory groups and nested package boundaries organize the normalized local hierarchy. When that hierarchy has one top-level local group, the generator omits it and promotes its direct files and child groups. When it has multiple top-level local roots, the generator preserves each group. External packages remain in their own independent group and never affect this local-root decision; never expand their internals.
5. Unmarked dependency edges are runtime dependencies. Edges with kind `type-only` exist only before TypeScript compilation.
6. When adopting the candidate, set the diagram's `generatorId` to `js-module-dependency-graph`. Record free-form `generatorInstructions` that state the invocation runs from the consumer scope root and include the complete command. Replace the session-specific absolute generator directory with `<generator-directory>`, use `--scope "."`, and keep every option and selected source path unchanged.
7. Preserve or choose the surrounding diagram `id`, `title`, and `layout` separately.
8. Validate the complete Architecture Companion artifact through the standard validation command before review.

The analyzer emits only dependencies confirmed by dependency-cruiser resolution. Missing or ambiguous references are omitted without routine warnings.
