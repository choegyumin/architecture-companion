---
name: architecture-companion
description: Generates and revises Architecture Companion artifacts that capture product Behaviors and code Designs from source evidence, serves the local Review UI, and handles follow-up requests from stored Annotations. Use this skill whenever the user wants to visualize product flows or code structure in order to review them, asks to start the review UI or provide a review URL, needs an existing artifact fixed, or requests changes, explanations, or another review after an Architecture Companion review.
---

# Architecture Companion

Presents product behavior and software design as interactive diagrams so the user can review them alongside source evidence.

`<AC>` is the installed skill directory containing this file, `artifact-writing.md`, `review-follow-up.md`, `schemas/`, and `runtime/`. Running it requires Node.js `22.18.0` and no package installation. When an Architecture Companion command succeeds, do not separately report Node.js version differences in the user's environment.

Use the absolute path of the consumer directory the user designates as `<scope>`. Ask only when the intended scope is genuinely unclear, and never substitute or infer the working directory or a Git root. Keep the same absolute path for the duration of a request.

## Request routing

- When a new diagram is needed or an existing diagram must change, run **Artifact writing**.
- When a reviewable screen or URL is needed, run **Start the Review UI and hand off the URL**.
- When the user returns to the coding harness after reviewing in the Review UI, start with **Review follow-up**. When its outcome requires diagram changes or another review, continue with the two procedures above.

## Artifact writing

1. If `<scope>/.architecture-companion/behaviors/` or `<scope>/.architecture-companion/designs/` exists, read the diagram files (`<id>.json`) inside first and separate the diagrams to preserve, modify, replace, add, or remove according to the request.

2. Read `<AC>/schemas/diagram.schema.json` and follow its linked `$ref`s to confirm the exact JSON structure. Then read `<AC>/artifact-writing.md` and apply the writing rules common to all built-in and custom generators.

3. When creating or regenerating a diagram, discover the installed generators.

   ```sh
   node "<AC>/runtime/cli/view-generators.js" "<scope>"
   ```

   The command prints one JSON line with an array of descriptors carrying `id`, `description`, `source`, and an absolute `path`. If the user named an installed generator, follow that choice. Otherwise compare every `description` against the requested view, and never select by array position. Keep entries that share a logical `id`. When both `id` and `description` match, choose in `built-in`, `project`, `global` order. When no dedicated generator fits, choose the built-in `freeform`.

4. Read `<selected path>/GENERATOR.md` at the chosen absolute path and follow its additional investigation guidance, references, supporting files, and execution instructions. Generator guidance does not replace the common artifact-writing rules, and do not assume every generator provides the same files or entrypoint.

5. Investigate the source code, tests, configuration, and documentation you need, and edit the diagram files under `<scope>/.architecture-companion/behaviors/` and `<scope>/.architecture-companion/designs/` directly. Architecture Companion commands do not generate or merge the artifact. The artifact is the complete set of diagram files: one JSON file per diagram, named after its diagram `id` (lowercase kebab-case). Preserve unrelated diagram files and keep diagram and graph element IDs for the same concepts. Record the chosen descriptor's `source` and logical `id` as `generator` in `<source>:<id>` form on every diagram you create or regenerate.

6. Validate the candidate once it covers the full request scope.

   ```sh
   node "<AC>/runtime/cli/validate-schemas.js" "<scope>"
   ```

   On failure, fix the errors from stderr and run it again until it prints `Artifact is valid.`. If you edit any diagram file after a successful run, validate again before reporting completion or handing off a URL. Independently of validation, check that the diagram answers the review question, that the evidence and interaction order are accurate, and that it satisfies the generator guidance.

## Start the Review UI and hand off the URL

1. Use the explicit `<scope>`. If the current artifact has not changed since the most recent validation, reuse that result; otherwise validate it with `validate-schemas.js`. When the artifact is missing or invalid, do not hand off a URL.

2. Reuse a running server only when you can confirm it serves the same scope. Otherwise start the local review server as a background process.

   ```sh
   node "<AC>/runtime/cli/serve.js" "<scope>"
   ```

   Collect the single `http://127.0.0.1:<port>` URL line that stdout prints once the listener is ready. The command does not open a browser.

3. Briefly explain what the artifact covers and hand off the URL. Tell the user to leave the Annotations and Comments they need in the UI and then send a follow-up request to the coding harness. Do not use polling or blocking tool calls to wait for the request.

## Review follow-up

1. Before editing the artifact with an explicit `<scope>`, query the Annotation document of the active revision.

   ```sh
   node "<AC>/runtime/cli/view-annotations.js" "<scope>"
   ```

   The command validates the current artifact and prints `artifactRevisionId` and `document` as one JSON line. When the artifact is missing, both are `null`; when an artifact exists but no Annotations are stored, it returns the active `artifactRevisionId` with an empty document. Never replace a failed lookup with Annotations from another revision or scope.

2. Read `<AC>/review-follow-up.md`. Treat the user's coding-harness message as the primary request and the active revision's Annotations and Comments as review context.

3. Investigate the evidence the request needs and answer directly. Follow the **Artifact writing** procedure only when a diagram must change, preserving unrelated diagrams.

4. When the artifact changed or the user wants another review, run the **Start the Review UI and hand off the URL** procedure and provide the validated URL. Do not poll or keep a tool call open while waiting for the next request.
