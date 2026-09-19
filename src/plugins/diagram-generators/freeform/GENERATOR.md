---
id: freeform
description: Builds evidence-based Product Behavior and Code Design diagrams for questions no dedicated generator covers.
---

# Freeform Diagram Generator

For questions no dedicated generator covers, produce the smallest diagram set that lets a reviewer check product behavior and software design against source evidence. These guidelines add to the common artifact-writing rules the Architecture Companion Skill reads first.

1. Confirm the explicit consumer scope, the user's request, and any existing artifact. Investigate the source code, tests, configuration, and current documentation for evidence relevant to the request.

2. Before creating any element, decide what the reviewer needs to verify. Prefer boundaries, decisions, state changes, data movement, failure paths, and interactions over file inventories.

3. Create only the Product Behaviors and Code Designs the question needs. A Product Behavior shows the start, choices, and outcomes an actor observes; a Code Design shows structure, responsibilities, dependencies, data flow, and runtime interactions. When both are needed, give them separate review questions.

4. Keep one central question per diagram, and reduce the element count as long as no important branch or dependency is hidden. If static structure and time-ordered interaction are both needed but hard to read on one canvas, split the diagram.

5. Present as current state only facts confirmed against the implementation. Mark proposed behavior or designs, and assumptions the investigation could not confirm. Where possible, phrase diagram text in the user's language and domain terminology.

After writing the diagram, return to the Architecture Companion Skill workflow.
