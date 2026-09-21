---
id: sequence
description: Builds evidence-based sequence diagrams of confirmed time-ordered interactions between actors, components, and services.
---

# Sequence Diagram Generator

Use this generator when the time-ordered interaction itself is the review subject. These guidelines add to the common artifact-writing rules the Architecture Companion Skill reads first.

1. Confirm the explicit consumer scope, the user's request, and any existing artifact. Investigate the source code, tests, configuration, and current documentation for evidence of the interaction.

2. Define one central review question and trace the interaction from its trigger through the relevant outcomes. Include only the participants, messages, execution spans, and control regions needed to answer that question; omit unrelated static structure.

3. Model participants as lifelines and their interactions as message edges in the actual order. Use activations only when execution spans matter. Use fragments only for confirmed alternatives, optional paths, loops, concurrency, or failure regions, and choose `sync`, `async`, and `return` message types from source evidence.

4. Set `generatorId` to `sequence`, use the `sequence` layout, and leave `groups` empty. Use only lifeline and fragment nodes and message edges. Keep message endpoints, activations, and fragment branches consistent with the message order.

5. Present as current state only facts confirmed against the implementation. Mark proposed behavior or designs, and assumptions the investigation could not confirm. Attach source evidence close to the participant or message it supports, and where possible use the user's language and domain terminology.

After writing the diagram, return to the Architecture Companion Skill workflow.
