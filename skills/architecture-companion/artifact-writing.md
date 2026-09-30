# Artifact authoring rules

These authoring rules apply to all generators. See [`schemas/diagram.schema.json`](schemas/diagram.schema.json) and its referenced schemas for JSON structure and constraints. Follow the `GENERATOR.md` of the generator selected after discovery for diagram-specific construction and execution instructions.

## Review questions and evidence

Each diagram should answer one central review question. Avoid repeating the same meaning across multiple elements. Split a diagram if addressing different questions makes it too complex.

- Use Product Behavior for product behavior and journeys as observed by actors.
- Use Code Design for code structure, responsibilities, dependencies, runtime interactions, data flow, and system boundaries.
- Present only facts verified against the implementation as the current state. Clearly distinguish proposals and unverified assumptions.
- Passing schema validation does not guarantee accuracy. Separately check the answer to the review question, the correspondence between evidence and explanations, and the interaction order against the source.

## File organization and preserving existing artifacts

An artifact is the complete set of diagram files. Store each diagram in its own JSON file.

- Product Behavior: `<scope>/.architecture-companion/behaviors/<id>.json`
- Code Design: `<scope>/.architecture-companion/designs/<id>.json`

The filename must match the diagram's `id`. To remove a diagram, delete its file. Save complete diagrams, not merge directives or partial patches.

Preserve diagrams unrelated to the request. Keep existing IDs for diagrams and graph elements whose concepts retain their meaning; do not reuse an ID for a concept whose meaning has changed. When changing multiple files together, apply the changes consecutively while keeping each file valid on its own.

Architecture Companion calculates coordinates and dimensions, so do not store them in the artifact.

## Generators and regeneration context

For each generated or regenerated diagram, set `generator` to the selected descriptor's `source` and logical `id` as `<source>:<id>`. Reading an artifact must not require that generator to be installed.

Record choices that cannot be reproduced from `generator` alone as free-form text in `generatorInstructions`. Include the required inputs, options, working directory, commands, and manual steps. Preserve regeneration instructions that remain valid when editing the graph. If regeneration inputs or manual steps change, update the instructions to reflect what was actually applied.

Write commands to run from the target scope root. Replace session-specific absolute generator paths with `<generator-directory>`, and record source paths relative to the scope. Use `.` for the scope when the command supports it. Apart from this path normalization, preserve the options and selected source paths used for execution.

## Descriptions shown in the Review UI

Not every field allowed by the schema is displayed. Put explanations needed for review in fields that are actually shown for the underlying elements.

| Element         | Displayed fields to use for explanations  | Authoring notes                                                 |
| --------------- | ----------------------------------------- | --------------------------------------------------------------- |
| Group           | `title`, `description`                    |                                                                 |
| `default` node  | `title`, `kind`, `description`, `details` | Omit `kind` if every node repeats the same category.            |
| `lifeline` node | `kind`, `title`, `description`            |                                                                 |
| `fragment` node | `operator`, each branch's `guard`         | Put conditions needed for review in each branch's `guard`.      |
| `default` edge  | `kind`, `label`                           | Convey the relationship's meaning through the displayed fields. |
| `message` edge  | `label`                                   |                                                                 |

## Evidence links

Attach evidence close to the concept it supports. Use the diagram's `links` for evidence about the diagram as a whole, a node's `links` where supported for node evidence, and an edge's `href` for evidence about a relationship or interaction.

Use `https:` URLs for external evidence. For files within the target scope, use `source:` URLs resolved relative to that scope.

```text
source:///src/checkout/service.ts
```

- Do not include a hostname, credentials, or a query string.
- The decoded path must start with exactly one `/`. Do not use a leading `//`, backslashes, an empty path, or `..` path segments.
- Do not use line fragments such as `#L42`; the default opener cannot open them.
- Verify that the resolved path points to an existing regular file within the scope.

`validate-schemas.js` only checks that links are non-empty strings. Verify `source:` URL syntax, scope containment, file existence, and the relevance of the evidence yourself.
