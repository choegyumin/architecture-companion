---
id: js-module-dependency-graph
description: Map verified JavaScript and TypeScript module dependencies, directory and package groups, external package boundaries, and type-only edges.
---

# JavaScript module dependency graph generator

Use to review how JavaScript or TypeScript source modules depend on one another or on external packages. Run the executable to obtain a candidate graph, then incorporate it into the diagram according to the request.

## Artifact configuration

```json
{
  "generator": "built-in:js-module-dependency-graph",
  "diagram": { "layout": { "id": "dependency-graph" } }
}
```

## Execution

`<generator-directory>` is the absolute path to the generator directory selected after discovery, and `<scope>` is the absolute path to the target directory specified by the user.

```sh
node "<generator-directory>/run.js" \
  --base "<scope>" \
  [--tsconfig "<tsconfig-path>"] \
  [--exclude-path "<pattern>" ...] \
  <scope-relative-source-path>...
```

- Specify at least one source path. Files and directories are both allowed, but they must be within the scope.
- `--tsconfig` accepts an absolute or scope-relative path to an existing file within the scope. If omitted, `<scope>/tsconfig.json` is used when present; parent directories are not searched.
- `--exclude-path` can be repeated. Write patterns in gitignore syntax against slash-separated, scope-relative paths. Brace expansion is not supported, and patterns without slashes apply at every depth.

## Analysis scope

Source collection follows `.gitignore` files in the scope root and its subdirectories; it does not read rules above the scope. Recursive traversal skips `.git` and `node_modules` directories it encounters, but does not exclude test or generated files by name alone.

`--exclude-path` patterns are applied after the rules from each `.gitignore`. A later `!` pattern can undo an earlier exclusion, but a child cannot be re-included while its parent directory remains excluded. Explicitly specified input paths themselves bypass exclusion checks; their descendants are still subject to exclusion rules, including those inherited from parent directories. Generation fails if no source files remain to analyze.

Excluded file nodes and their incident edges are removed together. The analyzer does not create new descendant relationships or shortcut edges, or infer unresolved dependencies. It emits only dependencies confirmed by dependency-cruiser's resolution, and silently omits missing or ambiguous references.

## Output

On success, the command prints a single line of JSON to stdout containing the absolute path to a temporary graph file.

```json
{ "graphPath": "/temporary/path/graph.json" }
```

This file contains only a candidate `Artifact.graph` with `groups`, `nodes`, and `edges`. It is not a complete Architecture Companion artifact; do not copy it as a standalone artifact file.

## Interpretation and integration

Local source modules are nodes identified by their source files. Directory groups and nested package boundaries form the local hierarchy. If there is only one top-level local group, the generator omits it and promotes its immediate files and subgroups. If there are multiple top-level local roots, it preserves each group. External packages remain in a separate group and do not affect this local-root decision. Package internals are not expanded.

When groups exist, the overview hides relationships within top-level groups and aggregates relationships between groups or nodes outside groups, displaying them as `×N`. Focus a group, node, or aggregated path to inspect the relevant underlying edges. Without groups, the overview shows the underlying edges directly.

On an underlying edge, an absent `kind` indicates a runtime dependency, while a `kind` of `type-only` indicates a dependency that exists only before TypeScript compilation. An aggregated path may contain both types, so do not infer dependency types from its overview display alone.

1. Read the existing diagram file first, then read the temporary candidate graph programmatically. Preserve, modify, or replace the existing graph according to the request, keeping unrelated diagrams and IDs for concepts that retain their meaning.
2. Preserve or assign the enclosing diagram's `id` and `title`, and apply the **Artifact configuration** above.
3. Record the necessary regeneration context according to the skill's shared authoring rules.
4. Validate the entire artifact using the skill's shared authoring procedure.
