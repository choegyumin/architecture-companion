<h1 align="center" className="text-center" style="text-align: center;">
  <!-- TODO: Logo -->
  Architecture Companion
</h1>

<p align="center" className="text-center" style="text-align: center;">
  Use interactive diagrams to design and review code with your agent. Claude Code, Codex, OpenCode — it works in any coding harness.
</p>

<!-- TODO: Hero image -->

<p align="center" className="text-center" style="text-align: center;">
  <strong>English</strong> · <a href="README.ko.md">한국어</a>
</p>

<br><br>

## Quick Start

### 1. Install the skill

Install with the [skills.sh](https://skills.sh/) CLI. The skill requires Node.js 22.18.0 or later to run.

```sh
npx skills add choegyumin/architecture-companion
```

### 2. Generate a diagram, ask questions in comments, and give instructions

Diagrams are grounded in your code and help you understand it visually. You can also leave feedback directly on a diagram and use it to make follow-up requests to your agent.

```text
❯ /architecture-companion Draw the render tree for the cart page component.

● I used static analysis to create a component structure diagram rooted at CartPage.

  Artifact URL: http://127.0.0.1:4317
  Artifact name: Code Design > Cart Page Component Structure

❯ Check the comments and answer the questions.

● I found 2 comments on the artifact.

  1. CartItemList: "How many levels is the quantity change handler passed through?"
     onQuantityChange is passed through 2 levels: CartPage → CartItemList → CartItem (CartPage.tsx:24).
  2. OrderSummary: "Is the coupon discount calculated on the checkout total?"
     Coupon discounts apply only to the merchandise subtotal, excluding shipping. Shipping is handled separately through a 'free shipping coupon' (domain/cart.tsx:15, components/OrderSummary.tsx:25).

❯ Check the new comments and start working.

● I checked the new comments.

  1. CartPage: "Replace the inline markup in the items.length === 0 branch with an Empty component."
  2. CartItemList: "Keep CartPage responsible for quantity changes. Compose CartItem in CartPage and pass it as children. CartItemList should handle layout only."
  3. OrderSummary: "In the discount breakdown, show the shipping fee waiver as a separate line item from merchandise discounts."

  I'll start working on these changes.
```

<!-- TODO: Screenshots -->

<!-- TODO: Demo URL -->

### 3. Reuse diagrams in later work

Diagrams are saved as JSON artifacts beside the source they explain or in `.architecture-companion/artifacts/`. You can reopen saved artifacts for review, or ask your agent to regenerate them after the source changes, preserving the same purpose and criteria.

```text
❯ /architecture-companion Regenerate the artifacts from the current source code.
```

You can control which artifacts are discovered through `include` in `.architecture-companion/config.json`. `include` supports globs and defaults to `["**/*.archcomp.json"]`. Record natural-language instructions for your agent, such as placement rules for artifact files, in `instructions`.

If you do not want to commit artifacts, add `.architecture-companion/` to `.gitignore`. By default, paths listed in `.gitignore` are excluded from discovery, but JSON files under `.architecture-companion/artifacts/` are always discovered. You can keep artifacts in `.architecture-companion/artifacts/` without tracking them in Git.

<br><br>

## What Architecture Companion Can Do

Design, review, and feedback all happen within a single diagram.

| Capability             | Description                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Diagram creation       | Create diagrams in whatever form fits your question, including flowcharts and sequence diagrams.                                      |
| Source evidence        | Trace diagram elements and relationships back to the relevant source.                                                                 |
| Feedback and follow-up | Leave comments on elements, relationships, or empty areas of the canvas, then use them to ask your agent for explanations or changes. |

You can also create diagrams tailored to specific questions. Diagrams based on static analysis are deterministic: unchanged code always produces the same diagram.

| Diagram                         | Description                                                                                                                                                                                               | Static analysis |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Module dependency graph (JS/TS) | Groups folders hierarchically to show dependencies between files and references to external packages. Use Focus to inspect the detailed dependencies of files, folders, and dependency paths of interest. | Yes             |
| Component render tree (React)   | Shows which components each component renders. Select branches and toggle conditions to see how the rendered components change.                                                                           | Yes             |

<!-- TODO: Add support for "use case" diagrams linked to test code -->

<br><br>

## Why Architecture Companion?

AI generates the code, but people remain responsible for it. You still need to understand and judge whether the implementation meets requirements, whether exceptional cases have been handled, and whether roles, responsibilities, and ownership are where they belong.

Diagrams are one of the best tools for understanding code. But you can already get diagrams from agents or existing tools. Architecture Companion aims to close four gaps:

- **Agent-generated diagrams are interpretations.** When you ask a coding agent for a diagram, the model reads the code and draws the structure it infers. Asking again about the same code may yield a different diagram, and there is no way to check which source the depicted relationships came from. Architecture Companion generates diagrams grounded in static analysis results.
- **Diagram-level abstraction breaks context.** In approaches such as the C4 model, each diagram shows one level of the hierarchy. Showing a higher level hides relationships between internal elements, while showing only a lower level hides relationships with sibling elements at higher levels. Instead of abstracting the diagram itself, Architecture Companion reduces cognitive load by letting you interactively change what is shown within a single diagram.
- **Most diagrams are disposable.** Diagrams are still actively used to help people understand. Once you understand, though, their job is done. With features such as Annotation, Architecture Companion lets you leave feedback on diagrams and turn that feedback into follow-up work, supporting collaboration with AI beyond understanding alone.
- **General-purpose tools stop at dependency graphs.** Even tools that analyze code to generate diagrams mostly show only dependencies and references between files or modules. Architecture Companion tailors its analysis and visual representations to the question, with diagrams such as component render trees.

<!-- TODO: Add Spotlight (working name) to the "Most diagrams are disposable." bullet -->

[philosophy.md](docs/philosophy.md) explains Architecture Companion's design philosophy and background in more detail.

<br><br>

## Learn More

- [Architecture Companion — SKILL.md](skills/architecture-companion/SKILL.md)
- [Architecture and dependency boundaries](ARCHITECTURE.md)
- [Contributing guidelines](CONTRIBUTING.md)
- [Glossary](GLOSSARY.md)
- [Philosophy](docs/philosophy.md)
