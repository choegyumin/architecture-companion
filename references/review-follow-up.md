# Review Follow-up Rules

Apply these rules when the user has reviewed the artifact in the Architecture Companion Review UI and then sends a follow-up request to the coding harness. Interpret the user's current request together with the Annotations and Comments of the active artifact revision to decide the response.

## Active review context

In the result the skill queried, a non-null `artifactRevisionId` is an opaque value identifying the current artifact revision. Do not depend on its format or construct one yourself. Use only the returned `document.annotations` as the Annotations of that active revision. When both `artifactRevisionId` and `document` are `null`, no active artifact exists; when a non-null revision's `document.annotations` is empty, no Annotations are stored for that revision.

Each Annotation carries the following semantics.

- An Annotation has a single `comment`.
- On a Process canvas, `anchor.canvasId` has the form `process:<process-id>`.
- On a Design canvas, `anchor.canvasId` has the form `design:<design-id>`.
- When the reviewer selected a group, node, or edge, `anchor.target` records its `type` and stable element `id`.
- `anchor.target` is absent only for a canvas-level Annotation created without selecting an element.
- `anchor.point` is the pin's visual position and does not replace the selected element target.

Find the diagram in the active artifact through the Process or Design ID in `canvasId`, then match `target.id` inside that diagram. Runtime validation checks the Annotation structure but not whether these IDs actually exist in the active artifact. Prefer the stable element ID over the point when a target exists, and never guess a missing target from a nearby position or a similar title.

## Request interpretation

- The user's coding-harness message decides the action to take. Annotations and Comments are review context that supplements the request, not separate global instructions.
- Use only Annotations from the active revision. Never carry targets, coordinates, or Comments from retained old revisions into the current artifact by guesswork.
- Apply only the Annotations relevant to the request scope. Ask only when several Comments conflict and the user's message cannot settle the priority.
- Answer ordinary follow-up requests even when the active Annotation document is empty.
- When the user explicitly refers to a stored Annotation but the active document is empty or the anchor target does not exist, report the mismatch.

## Response decision

- When only an explanation or an answer to a question is needed, investigate the relevant evidence and answer directly without modifying the artifact.
- When a code or documentation change is requested, use the Annotations as context for location and intent; do not automatically interpret them as a diagram-change request.
- When a diagram must change, return to the skill's **Artifact writing** procedure and preserve unrelated diagrams and retained IDs. Never copy the previous revision's Annotations into the new revision or transform their coordinates.
- When the artifact changed or the user wants another review, run the skill's **Start the Review UI and hand off the URL** procedure and provide the validated URL.
