# Architecture Companion — AGENTS.md

When working in this repository, do not invoke, load, or reference the installed `architecture-companion` skill. Use only the files in this repository as the source of truth. The only exception is when the user explicitly requests verification of the installed skill.

Read `docs/glossary.md` for agreed project terminology and use its definitions consistently when discussing or modifying the project.

Before modifying code or making architecture decisions, read and follow `docs/architecture.md` for directory roles and dependency boundaries.

This repository dogfoods its own tooling. The root `.architecture-companion/` catalog is this repository's own review material and is smoke-tested (parse, layout, route) because it moves with every refactoring, while `showcases/.architecture-companion/` holds catalogs for sample projects that demonstrate generated diagrams and serve as the pinned routing test fixtures. When the artifact storage contract schema changes, both catalogs must be updated. The dogfooding catalog and the showcases run with `pnpm dev` and `pnpm dev showcases` respectively.
