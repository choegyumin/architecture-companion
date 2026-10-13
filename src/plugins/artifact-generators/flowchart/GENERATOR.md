---
id: flowchart
description: Create evidence-based flowcharts from verified control flow, decisions, and outcomes.
---

# Flowchart diagram generator

Use when control flow itself is the subject of review. Investigate and author the steps, decisions, and outcomes of a flow directly.

## Artifact configuration

```json
{
  "generator": "built-in:flowchart",
  "diagram": { "layout": { "layoutId": "general" } }
}
```

## Investigation and authoring

1. Trace the flow from its starting point to its outcomes, guided by the review question. Include only the steps, decisions, and outcomes the reviewer needs; omit unrelated static structure.
2. Represent steps as `default` (rectangle) nodes and decision points as `diamond` nodes. Mark the flow's endpoints with `kind`, for example `kind: "start"` and `kind: "end"`.
3. Label the outgoing edges of every decision so each branch's condition reads explicitly. Keep unrelated paths separate instead of merging them into one node.
4. Use groups only to enclose nodes that belong to one phase; leave `groups` empty otherwise.

Use the user's language and domain terminology wherever possible. Follow the skill's shared authoring procedure for checking evidence, distinguishing facts from proposals, preserving existing artifacts, and validation.
