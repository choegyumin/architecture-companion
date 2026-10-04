---
id: freeform
description: Create evidence-based Product Behavior and Code Design diagrams for questions not covered by a specialized generator.
---

# Freeform diagram generator

Use for questions that no specialized generator covers. Manually author the smallest set of diagrams needed to review product behavior and software design.

## Artifact configuration

```json
{
  "generator": "built-in:freeform",
  "layout": { "id": "elk-layered" }
}
```

Set `layout.options` using schema-supported options that suit the user's requirements and the diagram being represented.

## Investigation and authoring

1. Investigate the boundaries, decisions, state changes, data movement, failure paths, and interactions the reviewer needs to examine. Choose elements that answer the review question rather than listing files.
2. Use Product Behavior to show the starting points, choices, and outcomes observed by actors. Use Code Design to show structure, responsibilities, dependencies, data flow, and runtime interactions. If both are needed, give each a distinct review question.
3. Reduce the number of elements without hiding important branches or dependencies. Split the diagram if static structure and time-ordered interactions are difficult to read on a single canvas.

Use the user's language and domain terminology wherever possible. Follow the skill's shared authoring procedure for checking evidence, distinguishing facts from proposals, preserving existing artifacts, and validation.
