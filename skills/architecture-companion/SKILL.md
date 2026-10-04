---
name: architecture-companion
description: Create and update Architecture Companion artifacts that capture product behavior and code design grounded in source evidence, and support review and follow-up work through a local Review UI and saved Annotations. Use when the user wants to visualize product flows or code structure for review, requests a review interface or URL, wants to modify an existing artifact, or follows up on a review with requests for changes, explanations, or another review.
---

# Architecture Companion

Present product behavior and software design as interactive diagrams that can be reviewed alongside source evidence.

`<AC>` is the absolute path to the directory containing this `SKILL.md`. Node.js `22.18.0` or later is required; no package installation is needed in the target project.

`<scope>` is the absolute path to the target directory specified by the user. Use the same path throughout the request. Ask only when the intended scope is unclear; do not arbitrarily substitute the working directory or Git root.

## Request routing

For follow-up requests after a Review UI review, start with **Review follow-up**, even if the request includes diagram changes.

| Request                                                         | Starting procedure  | Documents to read                                                                                                                                  |
| --------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create a new diagram or modify an existing one                  | Artifact authoring  | `schemas/artifact.schema.json` and its referenced schemas, `artifact-writing.md`, and the `GENERATOR.md` of the generator selected after discovery |
| Provide a review interface or URL                               | Start the Review UI | The authoring documents only if artifact authoring is needed                                                                                       |
| Explain, make changes, or review again after a Review UI review | Review follow-up    | `review-follow-up.md`; also read the authoring documents if diagram changes are needed.                                                            |

Use the absolute paths defined above for `<AC>` and `<scope>` in the commands below.

## Artifact authoring

1. Read any existing diagram files in `<scope>/.architecture-companion/behaviors/` and `<scope>/.architecture-companion/designs/` first. Determine what to preserve, modify, replace, add, or remove based on the request. Preserve unrelated diagrams and existing IDs for concepts that retain their meaning.

2. Read `<AC>/schemas/artifact.schema.json` and its referenced `$ref` schemas to understand the JSON structure, and apply the shared authoring rules in `<AC>/artifact-writing.md`.

3. When generating or regenerating a diagram, discover the installed generators. For simple wording or metadata changes that do not rebuild the graph, skip discovery and execution and proceed to step 5.

   ```sh
   node "<AC>/runtime/cli/view-generators.js" "<scope>"
   ```

   The command prints a single line of JSON containing an array of descriptors with `id`, `description`, `source`, and an absolute `path`.

   - If the user specifies a generator, select it from the discovery results. If it is absent, report that and confirm an alternative with the user.
   - When regenerating an existing diagram without a user-specified replacement generator, prefer a descriptor matching the existing `generator`'s `source` and `id`. If several candidates match, distinguish them by `description` and the existing regeneration instructions. If the existing generator cannot be found, report that and confirm an alternative with the user.
   - For a new diagram with no user-specified generator, compare every `description` against the request. If no specialized generator fits, select the general-purpose generator from the discovery results.

   Do not select by array order or discard entries solely because they share a logical `id`. If candidates with identical `id` and `description` remain after applying these criteria, prefer `built-in`, then `project`, then `global`.

4. Read `GENERATOR.md` at the selected `path` and follow its investigation, reference, and execution instructions. File organization and entry points may differ between generators. Follow that guide for diagram-specific construction while also applying the shared authoring rules. When regenerating, use the diagram's `instructions` to retain the review purpose and as the starting point for source scope, options, working directory, and refinements. Adjust only what the current request or the selected generator's instructions require.

5. Check evidence in source code, tests, configuration, and documentation, and edit the diagram files directly. Even if a generator produces a candidate graph, compare it against the existing artifact, including manual refinements, and decide what to preserve, modify, or replace based on the request. For each generated or regenerated diagram, record the selected descriptor's `source` and `id` in `generator` as `<source>:<id>`. Every diagram must include `instructions` and `updatedAt` following the shared authoring rules. Record `vcs` when the diagram has a version-controlled code basis, and reassess its divergence when the content changes.

6. Validate the entire catalog after making changes.

   ```sh
   node "<AC>/runtime/cli/validate-schemas.js" "<scope>"
   ```

   On failure, fix the errors reported on stderr and rerun until the command prints `Catalog is valid.` If any files change afterward, validate again before reporting completion or sharing a URL. Separately from validation, check that the catalog covers the full requested scope, answers the review questions, and accurately reflects the evidence and interaction order.

   If the user also requested a review interface or URL, continue with **Start the Review UI**.

## Start the Review UI

1. Check that `<scope>/.architecture-companion/behaviors/` and `<scope>/.architecture-companion/designs/` contain at least one diagram JSON file between them. An empty catalog can pass schema validation, so directory existence or successful validation alone is not enough. Do not share a URL if there are no diagrams.

   Reuse the latest validation result if the current catalog has not changed since that validation. Otherwise, validate with the `validate-schemas.js` command above. Do not share a URL for an invalid catalog.

2. Reuse a running server only if you can confirm that it serves the same `<scope>`. Otherwise, start a server as a background process.

   ```sh
   node "<AC>/runtime/cli/serve.js" "<scope>"
   ```

   Once ready, the server prints a single line to stdout with a URL in the form `http://127.0.0.1:<port>`. This command does not open a browser.

3. Briefly describe what the catalog covers and share the URL. Tell the user to leave Annotations and Comments in the UI, then send a follow-up request through the coding harness. Do not use polling or blocking tool calls to wait for that request.

## Review follow-up

1. Retrieve the active revision's Annotations before handling the follow-up request.

   ```sh
   node "<AC>/runtime/cli/view-annotations.js" "<scope>"
   ```

   The command validates the current catalog and prints `catalogRevisionId` and `document` as a single line of JSON. Read `<AC>/review-follow-up.md` for rules on interpreting results, handling failures, identifying targets, and interpreting requests. Do not substitute an empty result or Annotations from another revision or scope for a failed retrieval.

2. Treat the user's message as the primary request and the active revision's Annotations and Comments as review context. Investigate relevant evidence to answer explanation requests, and make code or documentation changes within the requested scope. Continue with **Artifact authoring** only when diagram changes are needed.

3. If the follow-up changes the catalog or the user requests another review, run **Start the Review UI** and share the validated catalog's URL. Always validate after diagram changes, whether or not another review is requested.
