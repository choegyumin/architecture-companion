---
id: react-component-structure
description: Build React component structure graphs from verified composition relationships, covering direct rendering and node, render, and component slots.
---

# React component structure diagram generator

Use to review, at the source level, how React components within selected JavaScript and TypeScript source paths compose one another. Run the executable to obtain a candidate graph, then incorporate it into the diagram according to the request. This graph is not a reconstruction of the runtime render tree.

## Artifact configuration

```json
{
  "type": "design",
  "generator": "built-in:react-component-structure",
  "diagram": {
    "layout": {
      "layoutId": "component-structure",
      "options": {
        "elk": { "direction": "DOWN" }
      }
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
- `--hoc <name>`: Optional and repeatable. Declares a higher-order component by the callee identifier's local name, such as `--hoc withRouter`. A declared call resolves to its statically provable component argument under the same rules as React wrappers.
- `--loader <package>`: Optional and repeatable. Declares a loader package, such as `--loader @loadable/component`, whose default import supports the static-import form described below. No loader package is built in.
- `--render <name>`: Optional and repeatable. Declares a render helper by the callee identifier's local name, such as `--render wrapWithSpan`. A declared call renders its first argument under the caller's component, ignoring the remaining arguments.

## Analysis scope

The analyzer uses the TypeScript compiler resolvable from the target scope and the standard `lib.*.d.ts` declarations from that same package. If the target has no TypeScript compiler, a fallback is used without changing the target project's dependencies. Compiler configuration and missing standard types that prevent initialization are reported as errors rather than returning an incomplete graph.

The fallback cache is shared per user and compiler version. Missing package metadata, compiler entry points, or default standard declarations trigger a repair serialized across processes. An incomplete cache is quarantined only after the replacement installation has been verified. Unsafe cache directories are rejected, and waiting for an installation lock times out after 120 seconds without forcibly removing another process's lock.

Source collection covers `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, and `.cts` files. It applies `.gitignore` files in the scope root and its subdirectories, but does not read rules above the scope. Recursive traversal skips `.git` and `node_modules` directories it encounters, but does not exclude test or generated files by name alone. Explicitly specified input paths themselves bypass collection-stage exclusion checks; their descendants are still subject to exclusion rules, including those inherited from parent directories.

Resolved local component references outside the selected source paths remain visible as boundary nodes when their source files are inside `--base` and not excluded from collection. They retain their component identities and source links, with the description `Outside collection scope; internals not analyzed.` Only the referenced declarations are identified; their implementations, internal components, and rendering controls are not analyzed. Imports do not expand source collection. Files excluded by `.gitignore`, unresolved references, and references outside `--base` do not become local boundary nodes; explicitly collected files retain the input-path bypass rules above.

`--exclude-path` and `--exclude-component` determine what is displayed after the collected source has been analyzed. They also apply to uncollected local boundaries. These display filters therefore cannot re-include files excluded from collection by `.gitignore`. Display filters still apply to explicitly specified input files.

Both display filters use the same reduction rules. Matching components and components created inside their implementations are omitted. Values statically verified as supplied by a parent, however, pass through hidden boundaries and attach to the nearest visible owner. For example, in `App → Layout → Content`, where `App` creates `Content` and passes it to `Layout`, excluding `Layout` produces `App → Content`. Neither `Layout` nor components created inside its implementation remain in the graph.

Hidden elements are not recorded in the output JSON. Generation fails if no source files are collected or no local components remain after display filtering. When `--root` is specified, generation fails if none of the patterns selects a visible component.

The analyzer emits only statically verified relationships and does not infer runtime behavior from types alone. Unresolved references are omitted; recognized unsupported wrapper and loader references emit warnings as described below. Identical composition contexts are shared, so individual use locations and usage counts are not preserved. Provider annotations, other UI frameworks, runtime reconstruction, and change-impact analysis are not supported.

## Output

On success, the command creates a graph file in the operating system's temporary directory and prints a single line of JSON to stdout containing its absolute path.

```json
{ "graphPath": "/temporary/path/graph.json" }
```

This file contains only a candidate `Artifact.diagram.graph` with `groups`, `nodes`, `edges`, and the graph's `layoutContext` (`rootNodeIds` and `controls`). It is not a complete Architecture Companion artifact; do not copy it as a standalone artifact file. Preserve the graph's `layoutContext` when integrating the graph so the component structure renderer can display origins and rendering controls.

## Interpretation and integration

Each node represents a component definition in one verified composition context. Context expansion is the default, not an optional mode. Usages of the same definition share a node only when their outgoing relationships, rendering controls, and recursively composed target contexts are identical — and, for usages that render ancestor-supplied values, when the supplying usage contexts are structurally identical too. Suppliers are compared by their usage classes, not their definition ids: a component that renders content supplied through a node, render, or component prop is customized by its supplier, so usages fed by structurally different supplier contexts keep separate nodes even when the supplied content matches; usages fed identically are indistinguishable and share one node. Supplied values themselves stay mergeable, since they are the reused content, not the customized receiver. Control IDs are normalized before this comparison; equivalent repeated compositions share their controls rather than staying separate because their instance IDs differ. Different contexts remain separate even when their immediate child definitions are the same; recursive compositions are compared to a fixed point.

Named local components use the definition identifier `component:<scope-relative-file>#<name>`. Anonymous default components use a distinct `#default` identifier while retaining a display title derived from the file. When only one context remains for a definition, its node retains that definition identifier. Multiple contexts retain representative usage identities, which can add an `@<hash>` suffix derived from scope-relative usage paths. All nodes share the same category, so `kind` is omitted. External boundaries are identified by their package-boundary descriptions.

Node titles retain the original component name, never the instance hash or a serial number. Each node's `layoutContext.definitionId` identifies the definition, and `layoutContext.origins` records every verified `{ supplierDefinitionId, slot }` pair. The origin `slot` is the original supplied input, not a downstream renamed consumer input: supplying `Wrapper.header` and forwarding it to `Inner.children` retains the supplier's `header` origin while the edge's `composition.slot` uses `children`. Merging nodes unions these pairs without mixing one supplier with another supplier's slot. Supplier IDs identify definitions, including suppliers outside a focused graph; they are not necessarily visible node IDs. Suppliers that lose their node (`--root` focus) keep their display name through the graph registry: the generator lists every referenced definition without a node in `layoutContext.auxiliaryDefinitions` as `{ definitionId, title }`, and omits the registry when every supplier stays in the graph.

Stored edges use the following `composition` forms under `edge.layoutContext`, whether the edge is an unconditional `default` or a gated `control`:

- Direct rendering: omit `composition`, the default. The contract also accepts explicit `composition: null`, but this generator omits the default to keep artifacts compact.
- Node content, including `children`: `type: "node"` — content to render is supplied through the slot.
- Render prop: `type: "render"` — a function or template that creates the content is supplied.
- Component prop: `type: "component"` — a component definition is supplied.

For supplied relationships, `composition.slot` names the final visible renderer's or invoker's input with its original casing. `composition.origins` records the original `{ supplierDefinitionId, slot }` pairs belonging to that relationship. These are structured storage fields, not the general edge's display `kind` or `label`. The shared contract restricts `composition.type` to `node`, `render`, and `component`; there is no stored direct-rendering value. Omitting `composition` has the same direct-rendering meaning as explicit `null`; absence does not mean unknown or unrecorded analysis. An edge with no composition stores no `layoutContext`: the generator never emits an empty `layoutContext: {}`.

The visual parent of a supplied value is its verified local renderer or invoker. Local prop forwarding is traced through verified named aliases and static prop objects. Supplier IDs identify the definitions that created the supplied values, including suppliers outside a focused graph. Equivalent merged relationships union their original supplier-slot pairs without changing the existing context comparison. Different supplier contexts are not merged merely because their target definitions match. Node `layoutContext.origins` remains the aggregate used on component cards; the component structure renderer does not add a separate composition label to the edge.

External component boundaries remain visible and connected, but package implementations are not expanded. External boundaries carry `synthetic: true` as generator-synthesized presentation boundaries; local components and uncollected local boundaries omit the marker. External provenance is traced through immutable `const` aliases and named, default, and star re-exports in local barrel modules to the canonical package export. Mutable aliases remain unresolved. External boundaries excluded by component filters follow the same rules as hidden local boundaries.

External member references require a declared property or an applicable index signature, including members of CommonJS `export =` objects. Whitespace and comments in property access do not change member identity or make missing members valid. Existing import naming is preserved: for `export = UI`, a default import of `UI.Button` retains `UI.Button`, while a namespace import uses `Button`. Package and relative imports retain their own provenance even when the same source is selected for local analysis, including references supplied through component registries. Package-owned JSX values are not expanded as caller-supplied content.

Local values statically verified as supplied through node props, render props, component props, or component registries remain connected. Results from event-style `onX` callbacks are omitted at external boundaries because their return values are not verified as being rendered.

### Static wrappers and loaders

React `memo` and `forwardRef` references, including const-bound results and default exports, resolve to the original component definition. An uncollected target follows the local-boundary policy above. Existing inline wrapper definitions remain supported. A memo comparator does not change the component structure and is not analyzed. Factory-reference tracing requires immutable bindings; mutable aliases and explicit binding reassignments are not followed.

A higher-order component declared through `--hoc <name>` matches by the callee identifier's local name: `withRouter(RawLogin)` resolves to `RawLogin`'s definition, including const-bound results and default exports under the same immutable-binding rules. The declaration is the caller's assertion about a call shape, not an import-origin check, so any collected call whose callee identifier matches a declared name is treated as a higher-order component. The first argument must be a statically provable component reference — an identifier, a member reference, or another recognized factory call; anything else warns `unsupported-hoc` while keeping the reference unresolved. Curried forms such as `connect(mapState)(Component)` do not match, because the outer call's callee is not a declared identifier, and stay unresolved without a warning. `React.memo`, `forwardRef`, and `Object.assign` remain recognized without declarations; no other library is built in.

The native global `Object.assign(Component, { Sub, Other: OtherComponent })` preserves the callable component's identity. Actual uses of `<Wrapped.Sub />` resolve to the attached component; attaching a member alone creates no relationship. Members require a single static object literal and immutable component references. Duplicate keys, getters/setters, spreads, computed keys, special `__proto__`/`prototype`/`constructor` properties, unknown or additional sources, and cyclic references are unsupported. Explicit member writes found in collected source, including assignments, updates, deletes, destructuring, loop targets, and other native `Object.assign` calls on the same component, prevent member inference when they target a member key the literal also assigns or their written keys cannot be proven; unrelated metadata writes such as `displayName` do not. An unsupported member does not discard a verified callable base, and warns only when the member is referenced.

A default import from a package declared through `--loader <package>` supports the one-argument form `loader(() => import("./panel"))`: a parameterless arrow directly returning a string-literal import. Relative paths and tsconfig aliases use the current compiler Program's module resolution. The module's default export must resolve to a local component definition. An eligible uncollected definition becomes a local boundary; loaders do not collect additional files or create synthetic component definitions. Options, `resolveComponent`, `.then` selectors, props-dependent callbacks, block-bodied factories, and computed imports are unsupported and warn `unsupported-loader`. Loader identity follows the import origin, so shadowed user functions are not treated as loaders.

React's own render APIs are recognized by import origin. `React.Children.map(children, fn)` iterates like an array `.map`: inside the callback, the first parameter stands for one element of the iterated incoming prop, so rendering or forwarding it routes that prop. `React.cloneElement(element, props)` renders the cloned element; argument props layer on top without removing the element from this component's subtree. `React.createElement(tag, props, ...children)` with a string tag renders its children arguments; with a prop-supplied tag the component-prop route is kept and the children arguments also render in this subtree; children of any other unresolved tag are traced for uses but produce no prop routes. `createPortal(children, container)` from `react-dom` renders its first argument; the container is not analyzed. A JSX tag `X.Provider` or `X.Consumer` where `X` resolves to a verified `createContext(...)` binding renders its children in place, like an intrinsic tag; the same member on any other value stays an unresolved wrapper whose children are not traversed. A `useMemo(factory, deps)` value in a rendered or supplied position resolves to the factory's return expressions; the dependency list does not constrain routing.

A `--render` declaration works like `--hoc`: it matches the callee identifier's local name and is the caller's assertion about a call shape, not an import-origin check. Undeclared helpers stay unresolved without a warning.

### Unsupported-reference warnings

The CLI writes nonfatal warnings to stderr after successfully writing the candidate graph. Each warning has the form `[code] scope-relative-file:line:column: reason`, with one-based positions at the factory call. Repeated references are deduplicated by factory location and reason. Codes identify unsupported React wrappers, declared higher-order components, assigned members, loaders, and mutable factory bindings. Success still returns exit code 0 and exactly one stdout JSON line. Fatal errors still fail without a success line or buffered warnings. Warnings do not appear in the graph JSON.

Warnings apply to recognized factories in collected source reached while analyzing rendering or supplied component references, not unused factories. They describe analysis before display filtering, so `--exclude-path`, `--exclude-component`, and `--root` do not suppress them. A factory outside collection does not produce a new warning; existing alias/barrel tracing to collected definitions still works.

### Rendering controls

The graph's `layoutContext` records `rootNodeIds` — the starting node IDs, including explicit `--root` selections and source components in recursive graphs — and `controls` — real source-level rendering decisions, scoped to their usage context. Repeated simultaneous JSX uses alone never create a control.

The analyzer traces ternaries, chained `&&`, `||`, `??`, `if`/`else`, early returns, and `switch` cases, including fallthrough and unlabeled conditional breaks. It preserves nested decisions in immutable output aliases, supplied children/node/render/component values, render callbacks, and verified consumer-side forwarding or rendering. Rendered left operands of `||` and `??` remain represented. Hidden forwarding boundaries retain their constraints and attach controls to the nearest visible owner; controls without any surviving visible route are omitted.

A control has a `controlId`, owning visible node `ownerNodeId`, source-derived `label`, and prerequisite `dependsOn` paths. Conditional controls use `type: "conditional"` and `on`/`off` values. A ternary with a null, undefined, or boolean non-rendering arm becomes one conditional control; its rendered arm uses `on`, with a negated label when the true arm is empty. Branch controls use `type: "branch"` and descriptive `cases` (each with its own `caseId` and `label`); a branch whose two cases are one subject and its negation carries `polarityPair: true`, so the owner's field renders a switch rather than a select. Each `control` edge's `activeWhen` and each control's `dependsOn` are an OR of paths, with each path an ordered AND of `{ controlId, value }` requirements. An ungated composition stores no ruleset: it is a plain `default` edge. Focusing on a root removes constraints owned outside that focused graph, treating the selected root as a new starting point.

Polarity pairs are stored in `[ON, OFF]` order; their case IDs retain their source meaning. For `if (!ready)`, the `false` case is ON and the `true` case is OFF. The analyzer delegates `!`-notation label normalization, polarity selection, and case ordering to the common `features/diagram/control-polarity` calculation. TypeScript expression equivalence, comparison complements, and graph rewriting remain source-analysis responsibilities. Nullish alternatives preserve their `operand == null` complement rather than substituting logical negation. Consumers read the stored order without parsing labels again.

Decision nodes, split path segments, and non-component case nodes are display projections the viewer derives from these controls; they are never stored in the graph.

The renderer owns initial selections: conditional switches start off; branch selection uses reachable descendant count, then maximum depth, then case id. Controls describe source structure, not independent runtime state variables. The analyzer does not execute conditions, infer a happy path, prove correlations between different conditions, or guarantee every runtime combination.

Mutable or reassigned output aliases and arbitrary helper-call results remain unresolved. Loop iteration guards, exception routing, and labeled exits are not modeled; return expressions discovered in those unsupported statement forms retain source relationships without additional controls for that statement. This implementation does not add value transforms over iterated children beyond rendering or forwarding callback results, traversal through unresolved JSX wrappers other than verified context accessors, intrinsic spread-only children consumption, broader default-object/module-fallback resolution, or external-symlink provenance support.

1. Read the existing diagram file first, then read the temporary candidate graph. Preserve, modify, or replace the existing graph according to the request, keeping unrelated diagrams and IDs for concepts that retain their meaning.
2. Set the enclosing artifact's `type` to `design`, apply the **Artifact configuration** above, and record the necessary regeneration context according to the skill's shared authoring rules. Artifact identity comes from its scope-relative file path; do not store an `artifactId`.
3. Validate the entire artifact using the skill's shared authoring procedure.
