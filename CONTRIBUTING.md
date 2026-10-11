# Contributing Guidelines

## Project Documents

- Project terminology is defined in `GLOSSARY.md`. Follow these definitions in discussions, code, and documentation.
- Before modifying code or making architecture decisions, check `ARCHITECTURE.md` for directory roles and dependency boundaries.

## Dogfooding

This repository dogfoods its own tool. The root `.architecture-companion/` artifacts are this repository's own review material and double as test fixtures, and `showcases/.architecture-companion/` holds the artifacts of sample projects that demonstrate generated diagrams. When the schema of the artifact storage contract changes, both sets of artifacts must be updated. Commit updated artifacts separately from the changes that caused them: commit the other changes first and the artifacts after, so the artifacts record the correct Git Revision. Run the dogfooding artifacts with `pnpm dev` and the showcases with `pnpm dev showcases`.

## Skill Distribution

The skill is distributed as the entire `skills/architecture-companion/` directory.

- `SKILL.md`, `*.md` — skill instruction documents, edited directly in the repository.
- `runtime/` — everything needed at runtime. `cli/` is the tsup bundle of `src/cli/`; the run scripts under `artifact-generators/` are bundled from `src/plugins/artifact-generators/`, and their `GENERATOR.md` files are copied from the same source. `client/` is the Vite build output of the review UI.
- `schemas/` — the JSON schemas of the artifact storage contract, generated from the schema definitions.

`pnpm build` deletes and regenerates `runtime/` and `schemas/`. Do not edit these generated files directly; fix the originals under `src/` and refresh them through a build. After the build, `verify-skill.ts` checks the directory structure.

## Git Hooks

This repository manages git hooks with lefthook, which is installed automatically on `pnpm install`. On commit, staged files are formatted and commit messages are checked automatically.

## Commit and PR Messages

Write commit and PR titles and descriptions in English.

Commit messages follow the Conventional Commits format (`type(scope): subject`) checked by commitlint. The available types and scopes are documented with their meanings as comments in `commitlint.config.mjs`. The configuration is short, so the file itself is the single source of truth and no separate document exists. Before writing a commit message, check the configuration file to determine the type and scope.

PR titles follow the same format. Since commitlint applies only to commit messages, PR titles are kept consistent by convention.
