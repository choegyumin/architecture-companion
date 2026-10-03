---
id: sequence
description: Create evidence-based sequence diagrams from verified, time-ordered interactions between actors, components, and services.
---

# Sequence diagram generator

Use when time-ordered interactions are themselves the subject of review. Investigate and author the messages and execution flow between participants directly.

## Artifact configuration

```json
{
  "generator": "built-in:sequence",
  "layout": { "id": "sequence" }
}
```

## Investigation and authoring

1. Trace the interaction from its starting point to the relevant outcome, guided by the review question. Include only the necessary participants, messages, execution spans, and control regions; omit unrelated static structure.
2. Represent participants as lifeline nodes and interactions as message edges. Place messages in `graph.edges` in actual interaction order, and determine their `sync`, `async`, or `return` type from source evidence.
3. Use activations only when execution spans matter. Use fragments to represent verified alternatives, optional paths, loops, concurrency, and failure regions.
4. Leave `groups` empty and use only lifeline and fragment nodes and message edges. Connect both ends of each message to lifelines, and align activations and fragment branches with message order.

Use the user's language and domain terminology wherever possible. Follow the skill's shared authoring procedure for checking evidence, distinguishing facts from proposals, preserving existing artifacts, and validation.
