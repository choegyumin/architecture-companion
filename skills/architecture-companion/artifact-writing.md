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

## Authoring metadata

- `updatedAt`: Record the current content's completion time from the system clock in UTC ISO 8601. Do not refresh it on reads, validation, unchanged saves, or Annotation changes.
- `vcs.revision`: Record the code revision used as the basis, not the artifact's own commit or internal artifact revision ID. Use the version control system's native identifier; for Git, use the full commit hash. Omit `vcs` entirely when no version-controlled code basis exists.
- `vcs.divergesFromRevision`: Set to `true` only when the represented behavior, structure, or design differs from that revision, including uncommitted implementation changes or unimplemented proposals; otherwise use `false`. Do not infer divergence from working-tree status or post-generation edits. Source interpretation, summarization, and intentional presentation refinements recorded in `instructions` do not by themselves constitute divergence.

On content changes, update `updatedAt`; if `vcs` is present, reassess `divergesFromRevision`. Retain `revision` unless the code basis changes; when it does, verify retained content against the new basis and set both VCS fields together.

For existing artifacts, recover trustworthy metadata or reauthor the content and record its new completion time. Do not invent historical timestamps or revisions; file modification times or the current clock alone are not sufficient evidence.

## Generators and regeneration context

For each generated or regenerated diagram, set `generator` to the selected descriptor's `source` and logical `id` as `<source>:<id>`. Reading an artifact must not require that generator to be installed.

Every diagram must include `instructions`, a non-empty Markdown string specifying how to recreate it from current source while retaining its review purpose, analysis scope, and presentation intent. It records diagram-specific choices, not general generator usage. The goal is to apply the same criteria to current source, not to reproduce an earlier graph unchanged. These rules apply to both executable generators and manually authored diagrams.

Use the following sections in order:

- `## Purpose` (required): State the review question and what the diagram is intended to examine.
- `## Regeneration` (required): For an executable generator, record the working directory and a complete command with all selected inputs and options. Treat the command as the source of truth for execution inputs rather than repeating them in prose. For a manually authored diagram, record the investigation targets, scope, and construction criteria instead.
- `## Refinements` (optional): Include only when diagram-specific refinements are needed beyond the regeneration procedure. State what to change, how, and why, such as grouping, wording improvements, or intentionally omitted relationships. Provide enough detail for another agent to apply and reassess the refinements against current source.

For example, the parsed field value may contain:

````markdown
## Purpose

Review dependencies between checkout modules and external packages.

## Regeneration

Run from the scope root:

```sh
node "<generator-directory>/run.js" \
  --base "." \
  --exclude-path "*.test.*" \
  "src/checkout"
```

## Refinements

Add source-verified responsibility descriptions to checkout entry-point nodes to clarify their architectural roles.
````

Write commands to run from the target scope root. Replace session-specific absolute generator paths with `<generator-directory>`, and record source paths relative to the scope. Use `.` for the scope when the command supports it. Apart from this path normalization, preserve the options and selected source paths used for execution. Compose the Markdown as ordinary text and serialize the diagram as JSON so that line breaks, quotes, and backslashes are escaped correctly; no dedicated script is required.

Do not repeat shared schema, validation, or ID-preservation rules, or the generator's general usage guide. Do not copy the current node and edge inventory, session-specific paths, temporary file paths, or work history into the instructions.

Preserve instructions that remain valid when source changes affect only the graph. Update them when the purpose, regeneration inputs or procedure, or refinements change, so they reflect what was actually applied. The current user request takes precedence over existing instructions; revise the instructions to match the criteria used.

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
