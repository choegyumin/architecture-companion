---
id: react-component-structure
description: Build React component structure graphs from verified direct-render, node-prop, render-prop, and component-prop relationships.
---

# React component structure diagram generator

Use to review, at the source level, how React components within selected JavaScript and TypeScript source paths compose one another. Run the executable to obtain a candidate graph, then incorporate it into the diagram according to the request. This graph is not a reconstruction of the runtime render tree.

## Diagram configuration

```json
{
  "generator": "built-in:react-component-structure",
  "layout": {
    "id": "elk-layered",
    "options": {
      "nudgeObstacleNodes": true,
      "elk": { "direction": "DOWN" }
    }
  }
}
```

This arranges component composition relationships from top to bottom.

## Execution

`<generator-directory>` is the absolute path to the generator directory selected after discovery, and `<scope>` is the absolute path to the target directory specified by the user. No package installation is needed in the target project.

```sh
node "<generator-directory>/run.js" \
  --base "<scope>" \
  "src"
```

- `--base <directory>`: Required. The target scope used for source links and path containment checks.
- `<source-path>...`: Required positional arguments. Specify one or more files or directories using absolute or scope-relative paths.
- `--tsconfig <path>`: Optional. An absolute or scope-relative path to an existing TypeScript configuration file within the scope. If omitted, `<scope>/tsconfig.json` is used when present; parent directories are not searched.
- `--exclude-path <pattern>`: Optional and repeatable. A gitignore pattern against scope-relative paths. Brace expansion is not supported, and patterns without slashes apply at every depth. A later `!` pattern can undo an earlier exclusion, but a child cannot be re-included while its parent directory remains excluded.
- `--exclude-component <glob>`: Optional and repeatable. Excludes components by title or stable component ID. A later `!` pattern can undo an earlier exclusion. For example, `external:@base-ui/react#*` hides all boundaries from that package without hiding local wrappers with the same names.
- `--root <glob>`: Optional and repeatable. Selects components by title or stable component ID. After exclusion filters are applied, keeps only the selected components and the components they compose, directly or indirectly. Combines the sets reachable from roots selected by multiple patterns.

## Analysis scope

The analyzer uses the TypeScript compiler resolvable from the target scope and the standard `lib.*.d.ts` declarations from that same package. If the target has no TypeScript compiler, a fallback is used without changing the target project's dependencies. Compiler configuration and missing standard types that prevent initialization are reported as errors rather than returning an incomplete graph.

The fallback cache is shared per user and compiler version. Missing package metadata, compiler entry points, or default standard declarations trigger a repair serialized across processes. An incomplete cache is quarantined only after the replacement installation has been verified. Unsafe cache directories are rejected, and waiting for an installation lock times out after 120 seconds without forcibly removing another process's lock.

Source collection covers `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, and `.cts` files. It applies `.gitignore` files in the scope root and its subdirectories, but does not read rules above the scope. Recursive traversal skips `.git` and `node_modules` directories it encounters, but does not exclude test or generated files by name alone. Explicitly specified input paths themselves bypass collection-stage exclusion checks; their descendants are still subject to exclusion rules, including those inherited from parent directories.

`--exclude-path` and `--exclude-component` determine what is displayed after the collected source has been analyzed. These display filters therefore cannot re-include files excluded from collection by `.gitignore`. Display filters still apply to explicitly specified input files.

Both display filters use the same reduction rules. Matching components and components created inside their implementations are omitted. Values statically verified as supplied by a parent, however, pass through hidden boundaries and attach to the nearest visible owner. For example, in `App → Layout → Content`, where `App` creates `Content` and passes it to `Layout`, excluding `Layout` produces `App → Content`. Neither `Layout` nor components created inside its implementation remain in the graph.

Hidden elements are not recorded in the output JSON. Generation fails if no source files are collected or no local components remain after display filtering. When `--root` is specified, generation fails if none of the patterns selects a visible component.

The analyzer emits only statically verified relationships and does not infer runtime behavior from types alone. Unresolved references are silently omitted. Identical composition contexts are shared, so individual use locations and usage counts are not preserved. Provider annotations, other UI frameworks, runtime reconstruction, and change-impact analysis are not supported.

## Output

On success, the command creates a graph file in the operating system's temporary directory and prints a single line of JSON to stdout containing its absolute path.

```json
{ "graphPath": "/temporary/path/graph.json" }
```

This file contains only a candidate `Diagram.graph` with `groups`, `nodes`, and `edges`. It is not a complete Architecture Companion artifact; do not copy it as a standalone artifact file.

## Interpretation and integration

Each node represents a component definition in one verified composition context. Usages of the same definition share a node only when their outgoing relationships, supplier identities, and recursively composed target contexts are identical. Different contexts remain separate even when their immediate child definitions are the same; recursive compositions are compared to a fixed point.

Named local components use the definition identifier `component:<scope-relative-file>#<name>`. Anonymous default components use a distinct `#default` identifier while retaining a display title derived from the file. When only one context remains for a definition, its node retains that definition identifier. Multiple contexts retain representative usage identities, which can add an `@<hash>` suffix derived from scope-relative usage paths. All nodes share the same category, so `kind` is omitted. External boundaries are identified by their package-boundary descriptions.

Relationships are displayed as follows:

- Direct render: no visible relationship label.
- Node prop, including `children`: `kind` is `NODE (<renderer prop name>)`; `label` is `from <supplier>`.
- Render prop: `kind` is `RENDER (<invoker prop name>)`; `label` is `from <supplier>`.
- Component prop: `kind` is `COMPONENT (<renderer prop name>)`; `label` is `from <supplier>`.

The visual parent of a supplied value is its verified local renderer or invoker. The label names the component definition that created the supplied target. Local prop forwarding is traced through verified named aliases and static prop objects. `kind` uses the prop name of the final visible renderer or invoker with its original casing, while `label` retains the original supplier. Supplier names are sorted and combined only when analysis verifies them for the same relationship within one usage context. Different supplier contexts are not merged merely because their target definitions match.

External component boundaries remain visible and connected, but package implementations are not expanded. External provenance is traced through immutable `const` aliases and named, default, and star re-exports in local barrel modules to the canonical package export. Mutable aliases remain unresolved. External boundaries excluded by component filters follow the same rules as hidden local boundaries.

External member references require a declared property or an applicable index signature, including members of CommonJS `export =` objects. Whitespace and comments in property access do not change member identity or make missing members valid. Existing import naming is preserved: for `export = UI`, a default import of `UI.Button` retains `UI.Button`, while a namespace import uses `Button`. Package and relative imports retain their own provenance even when the same source is selected for local analysis, including references supplied through component registries. Package-owned JSX values are not expanded as caller-supplied content.

Local values statically verified as supplied through node props, render props, component props, or component registries remain connected. Results from event-style `onX` callbacks are omitted at external boundaries because their return values are not verified as being rendered.

1. Read the existing diagram file first, then read the temporary candidate graph. Preserve, modify, or replace the existing graph according to the request, keeping unrelated diagrams and IDs for concepts that retain their meaning.
2. Apply the **Diagram configuration** above and record the necessary regeneration context according to the skill's shared authoring rules.
3. Validate the entire artifact using the skill's shared authoring procedure.
