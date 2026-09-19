# Artifact Writing Rules

Common semantics and layout rules to apply when creating or modifying diagrams. Read [`diagram.schema.json`](diagram.schema.json) and its linked JSON Schemas directly for the exact JSON structure. This document does not repeat the schemas; it explains how to choose properties and compose content.

## Artifact composition and changes

- Each diagram is one JSON file. Store behavior diagrams in `.architecture-companion/behaviors/<id>.json` and design diagrams in `.architecture-companion/designs/<id>.json`.
- The file name must equal the diagram `id`, and IDs are lowercase kebab-case (`^[a-z0-9][a-z0-9-]*$`) because they double as file names. Removing a diagram means deleting its file.
- Put user-visible behavior and actor journeys in `behaviors`.
- Put code structure, architecture, runtime interactions, data flow, and system boundaries in `designs`.
- The artifact is the complete set of diagram files. Preserve unrelated diagram files, and never write merge instructions or partial patches.
- Reuse existing diagrams and graph element IDs for the same concepts. Do not repurpose an existing ID for a concept whose meaning changed.
- Record the chosen logical generator ID as `generatorId` on every diagram you create or regenerate. Reading the artifact must not require that generator to be installed.
- When several files belong to one change, edit them in a single continuous sequence. Every individual file stays valid on its own, so intermediate states only affect meaning, never validity.

Make each diagram answer one central review question. Do not express the same meaning redundantly across multiple elements; when a graph grows complicated because it serves different questions, split the diagram.

## Element selection

- `group` bundles nodes that must be understood together under a real boundary or ownership. Use `parentId` for nested boundaries.
- `default` nodes represent general steps, states, components, services, data stores, and system entities.
- `lifeline` nodes represent the actors, components, and services participating in a time-ordered interaction. Use `activations` when execution spans matter.
- `fragment` nodes represent sequence control regions such as `alt`, `opt`, `loop`, and `par`, dividing their extent with `branches`.
- `default` edges represent general relationships such as flows, dependencies, ownership, and data movement.
- `message` edges represent time-ordered interactions between lifelines. `messageType` is one of `sync`, `async`, or `return`, and defaults to `sync` when omitted.

Place the explanation a review needs in the fields the Review UI displays.

- `default` nodes display `kind`, `title`, `description`, and `details`.
- `lifeline` nodes display `kind`, `title`, and `description`, but not `details`.
- `fragment` nodes display `operator` and each branch's `guard`. Do not put the only on-screen explanation in the schema-required `kind` and `title` or in the optional `description` and `details`.
- `default` edges display `kind` and `label`.
- `message` edges display `label` but not `kind`. Convey the message meaning through `label`.

Structural conditions such as the group hierarchy, node `groupId`, edge endpoints, activation and fragment message references, and ID uniqueness follow the contract of the schemas and the runtime validator.

## Layout selection

Architecture Companion computes coordinates and sizes, so the artifact never records them.

### `elk-layered`

Use for structural diagrams and general flows. Express structure and flow mostly with groups, default nodes, and default edges. `options.direction` is one of `UP`, `DOWN`, `LEFT`, or `RIGHT`, and defaults to `DOWN` when omitted. Set a direction only when it reads better than the default.

### `sequence`

Use only when the time-ordered interaction itself is the review subject.

- Include at least one lifeline.
- Leave `groups` empty.
- Use only lifeline and fragment nodes.
- Use only message edges, and connect `source` and `target` to lifelines.
- Place message edges in `graph.edges` in the actual interaction order.
- Keep activations and fragment branches consistent with that message order.

The runtime validator checks the structural preconditions. Verify the actual interaction order and the diagram's review fitness separately, from the investigated evidence.

## Evidence and source references

Attach links close to the concept they support.

- Put evidence for the whole diagram in the diagram's `links`.
- Put evidence for a default or lifeline node in the node's `links`.
- Put evidence for a relationship or interaction in the edge `href`.
- Use `source:` URLs for files inside the explicit consumer scope.
- Use `https:` URLs for external evidence.

`source:` URLs are interpreted against the explicit consumer scope.

```text
source:///src/checkout/service.ts
```

- Use the `source:` protocol without a hostname, credentials, or query string.
- The decoded path must start with a single `/`. Do not use a leading `//`, backslashes, an empty path, or `..` path segments.
- The installed Review UI's default opener cannot open line fragments, so do not use fragments such as `#L42`.
- The resolved path must stay inside the consumer scope and point to an existing regular file.

`validate-schemas.js` checks only that links are non-empty strings; it does not check `source:` URL syntax, scope containment, or file existence. Verify every source reference yourself before finishing. Validation also does not prove that links fit the evidence or that the diagram content is accurate, so compare them against the sources and never present proposals or assumptions as current facts.
