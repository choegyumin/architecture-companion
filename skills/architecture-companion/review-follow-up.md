# Review follow-up rules

Use these rules to interpret requests received after a Review UI review alongside the active artifact revision's Annotations and Comments. Follow `SKILL.md` for the retrieval command and the procedures for authoring and further review.

## Retrieval results and failure handling

The `artifactRevisionId` returned by `view-annotations.js` is an opaque identifier for the current artifact revision. Do not rely on its format or construct it yourself. Use only the accompanying `document.annotations` as that revision's Annotations.

- If both `artifactRevisionId` and `document` are `null`, there is no active artifact.
- If `artifactRevisionId` is present and `document.annotations` is empty, no Annotations are saved for that revision. Continue handling ordinary follow-up requests.
- If the command fails, the presence or absence of Annotations is unknown. Do not treat the result as an empty document or substitute results from another revision or scope.

If retrieval fails but the request can be handled using only the user's message and source evidence, report the failure and proceed. For example, if retrieval failed because of an artifact validation error and the request is to fix that error, inspect the error and files and make the fix. If the request depends on saved Annotation content, ask the user to confirm the content or target rather than guessing.

## Identifying Annotation targets

Each Annotation has one `comment`. Use `anchor.canvasId` to find the diagram in the active artifact.

- Product Behavior canvas: `behavior:<behavior-id>`
- Code Design canvas: `design:<design-id>`

An Annotation attached to a selected element has an `anchor.target`. Resolve the target according to the selection type:

| Target                     | How to identify it                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Group, node, or edge       | Find it within the diagram using its `type` and stable element `id`.                                                                                                                                               |
| Aggregated dependency path | For `type: "edge-set"`, find each underlying edge listed in `edgeIds`. `sourceId` and `targetId` identify the groups or nodes at the displayed aggregate's endpoints; they do not replace the underlying edge IDs. |
| Entire canvas              | An Annotation created without selecting an element has no `anchor.target`.                                                                                                                                         |

`anchor.point` is the pin's visual position. If there is an element target, use its ID rather than the coordinates. Runtime validation checks Annotation structure but does not check whether referenced IDs exist in the active artifact, so verify them yourself. Do not infer a missing target from a nearby position or similar title.

## Interpreting requests

The user's message in the coding harness determines the action to take. Annotations and Comments provide review context about location and intent; they are not separate global instructions.

- Apply only Annotations from the active revision that are relevant to the requested scope. Ask only when Comments conflict and the user's message does not resolve their priority.
- If the user explicitly refers to saved Annotations but the active document is empty or the target does not exist, report the mismatch.
- Answer explanation requests without changing the artifact. Do not automatically interpret requests for code or documentation changes as requests for diagram changes.
- Even when changing diagrams, do not copy Annotations from the previous revision to the new one or transform their coordinates. Do not apply targets or Comments from an old revision to the current artifact by guesswork.
