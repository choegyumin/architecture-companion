# Glossary

This glossary describes the concepts used to create and regenerate source-grounded Architecture Companion artifacts, review the product behavior and code design they represent, and use feedback to guide follow-up work.

## Language

**Companion**:
A synonym for Architecture Companion. The tool supports creating and regenerating artifacts grounded in source evidence, reviewing them, and following up on feedback.

### Scope and Artifacts

**Scope**:
The source directory that sets the context for artifact authoring and review, defines which catalog and annotations belong to it, and serves as the base for resolving source links. Represented in code as `CompanionScope`.

**Catalog**:
The complete collection of artifacts within a scope. Represented in code as `CompanionCatalog`.

**Artifact**:
An individual output that combines a diagram with its authoring and regeneration context.

**Product Behavior**:
An artifact type that shows product behavior and use cases from the actors' perspective.

**Code Design**:
An artifact type that describes code structure, responsibilities, dependencies, runtime interactions, data flow, and system boundaries.

### Artifact Authoring and Regeneration

**Artifact Generator**:
A generator used to author or regenerate artifacts. It provides authoring guidance and may also offer automated generation.

**Generator Discovery**:
The process of finding generators available to a scope before choosing one that fits the artifact's purpose.

**Generator Source**:
The origin of a generator, whether built into the tool, supplied by the target project, or available globally across projects.

**Generator Reference**:
A reference identifying the generator used to author an artifact and its source. It records the artifact's generation context rather than containing the generator itself.

**Artifact Purpose**:
What an artifact is intended to help reviewers examine or verify. It guides the choice of evidence and relationships to present.

**Candidate Graph**:
A draft graph produced by an executable generator from its analysis. It is a starting point for authoring, not a complete artifact.

**Regeneration Instructions**:
Artifact-specific instructions for recreating the artifact from current source while preserving its purpose and presentation criteria.

### Artifact Evidence and Versions

**Authoring Metadata**:
Context about when an artifact was completed and the state of the source code it is based on.

**Evidence**:
Source material or other verifiable information that supports an artifact's explanations and relationships. The term also covers links and other references used to cite that material.

**Catalog Revision**:
A particular version of the catalog's complete contents. An annotation document belongs to a catalog revision, not to the code revision used as an artifact's basis.

**Active Revision**:
The catalog revision currently under review in a scope. Its annotations and comments provide the context for the current review.

**Code Revision**:
The version of the code used as an artifact's basis, as identified by the version control system. It is the reference for assessing the represented behavior, structure, or design, not a version of the catalog.

**Divergence**:
A difference between the behavior, structure, or design represented by an artifact and the code revision it is based on. Summarizing the same code or refining the artifact's presentation does not, by itself, constitute divergence.

### Diagrams

**Diagram**:
The visual representation of product behavior or code design within an artifact, focused on the artifact's central purpose.

**Canvas**:
The interactive surface for viewing and working with an artifact's diagram. An annotation is associated with a particular diagram through its canvas.

**Graph**:
The structure of elements and relationships that forms a diagram's content. It describes what the elements mean and how they connect, independently of their visual arrangement.

**Layout**:
The approach used to arrange graph elements and display their relationships in a diagram.

**Route Requirement**:
A value one control must hold for a path to apply: one `control=value` pair. The atomic unit of edge activation conditions (`activeWhen`) and control prerequisites (`dependsOn`). Represented in code as `DiagramRouteRequirement`.

**Route Requirement Rule**:
Route requirements joined by AND: the rule holds only when every requirement in it holds. Rendered as one unit on the edge label. Represented in code as `DiagramRouteRequirementRule`.

**Route Requirement Ruleset**:
Route Requirement Rules joined by OR, in no particular order: the ruleset holds when any one rule holds. The type of `activeWhen` and `dependsOn`. Represented in code as `DiagramRouteRequirementRuleset`.

**Node**:
A graph element representing a concept, participant, or control-flow region in a diagram.

**Root Node**:
A node with no incoming edge, where a diagram's content starts. In a component structure diagram, a root renders without any incoming rendering path.

**Decision Node**:
A diamond-shaped node where one path branches into alternatives; each outgoing path carries its own condition.

**Group**:
An area that organizes related nodes and nested groups into a hierarchy.

**Bounding Group**:
A visual boundary outlining a collection of nodes. It is a display element, distinct from a group in the underlying graph.

**Edge**:
A graph element representing a relationship or interaction between two nodes.

**Edge Set**:
A collection of one or more edges treated as a single unit, for example when selecting them or attaching an annotation.

**Control**:
A decision that gates which paths apply. Branch controls choose exactly one of their cases; conditional controls toggle on or off. A control's `type` is `conditional` or `branch`. Controls may declare prerequisites on other controls (`dependsOn`). In a component structure diagram, controls come from component source and are stored in the graph's `layoutContext`. Represented in code as `DiagramControl`.

**Control case**:
One of the values a branch control chooses between. Each case appears as one port on the corresponding decision node.

**Guard**:
A label stating the condition under which a path applies. On a sequence diagram it describes a fragment's branch; on a component structure diagram it is a Route Requirement Ruleset derived from the stored relationship's `activeWhen`.

**Kind**:
A free-form display category stored as `kind` on common nodes and edges. It is descriptive text for display only and is never used as a tagged union's discriminator or for any other structural role such as selecting a schema shape or validating a field set.

**Layout Context**:
The layout-specific data of a graph, node, or edge, stored as its `layoutContext`. Which contract the `layoutContext` follows is decided by the artifact's `layout.layoutId`, and it is validated against the schema defined for that layout. It is not a free-form extension object and not runtime state; fields defined for one layout are not arbitrarily valid in another. For example, a component structure diagram stores its root nodes (`rootNodeIds`), controls, and optionally auxiliary definition names (`auxiliaryDefinitions`) in the graph's `layoutContext`.

#### Sequence Diagrams

**Sequence Diagram**:
A diagram that shows the time-ordered messages and control flow between participants.

**Lifeline**:
A node representing a participant over time in a sequence diagram.

**Message**:
An edge representing an interaction between two lifelines in a sequence diagram.

**Activation**:
An interval during which a lifeline's participant is executing.

**Fragment**:
A region of a sequence diagram that groups control flow such as alternatives, loops, or parallel execution.

**Branch**:
A span of messages within a fragment corresponding to a condition or alternative path.

#### Component Structure Diagrams

**Component Structure Diagram**:
A code design diagram that shows the components of a component tree and the rendering paths through which they compose.

**Composition**:
An edge representing a parent component composing a child, directly or through a slot. For a component structure edge, omitted `composition` (in the edge's `layoutContext`) or explicit `null` means direct rendering, the default. Other supply methods store a `composition` object with `type`, consumer-side `slot`, and original supplier `origins`. `composition.type` is one of `node`, `render`, or `component`. The consumer slot and the original supplier slot can differ after forwarding. A composition gated by controls is stored as the `control` edge type with its `activeWhen` Route Requirement Ruleset; the type itself is not exclusive to component structure diagrams.

**Slot**:
A named input used for component composition. The term covers inputs supplied with content to render, functions or templates that create content, and component definitions, and is not limited to one framework's slot API. A stored slot field records the source code's input name unchanged.

**Rendering Path**:
A conjunction of control choices under which a component renders. An edge applies when at least one of its rendering paths matches the current selection.

**Decision Node**:
In a component structure diagram, the projection of a branch control as a decision node, derived for display instead of stored in the graph. Its ports are the control's cases, and one outgoing path leaves through each port.

**Component Origin**:
The original supplier and slot through which a component was supplied. Per-edge `layoutContext.composition.origins` preserves the relationship's supplier definition IDs and original slot names. Node `layoutContext.origins` aggregates these origins for the component's card. The supplier's display name is resolved, not stored: `layoutContext.auxiliaryDefinitions` first, then the title of a node carrying the same `definitionId`, and otherwise the fixed label `outside graph`. The node's `layoutContext.definitionId` points to the source definition the node represents; the same definition can appear as several nodes after context expansion, and it is distinct from the node's own graph `nodeId`. Supplier definition IDs are not necessarily visible node instance IDs.

**Component Definition**:
A declaration in component source, identified as `component:<scope-relative-file>#<name>` by the React generator. The graph may reference a definition without showing a node for it: origins point at definitions (`supplierDefinitionId`), never at node instances. A definition with one usage context appears as one node whose `nodeId` equals the definition id; additional contexts add `@<hash>` suffixes. Definitions that stay referenced after their nodes drop out — for example under `--root` focus — can be named in the graph's `layoutContext.auxiliaryDefinitions`.

**Control Owner Component**:
The component whose source defines a control. The owner's card displays the control as a switch or select.

**Non-component Case/Node**:
A branch case no rendering path requires, shown as its own node, derived for display instead of stored in the graph, so rendering nothing stays a selectable rendering path. Nodes are per case and never merged: each is an individual piece of markup at its own branch site, not a reused definition the way identical component internals are.

#### Dependency Graph Diagrams

**Dependency**:
An edge representing a reference from one module to another, at runtime or type-only.

**Aggregated Dependency Path**:
A displayed path that groups dependency edges between the same visible endpoints, whether nodes or groups. The path is distinct from the individual underlying edges it represents.

### Review and Feedback

**Review**:
Examining diagrams alongside source evidence to assess product behavior or code design.

**Review Follow-up**:
Work that responds to requests for explanations, changes, or further review based on an earlier review. Annotations and comments from the active revision provide context for interpreting those requests.

**Annotation**:
A review mark attached to a canvas position or diagram element. It consists of one anchor and one comment.

**Annotation Comment**:
The written feedback in an annotation, distinct from the information that locates it.

**Annotation Anchor**:
The information that locates an annotation on a particular canvas. When the annotation refers to a selected element, the anchor also includes that target.

**Annotation Target**:
The group, node, edge, or aggregated dependency path that an annotation refers to. An annotation on the canvas as a whole has no separate element target.

**Annotation Pin**:
The marker showing an annotation's position on the canvas, distinct from the element it refers to.

**Annotation Document**:
The collection of annotations associated with a single catalog revision.
