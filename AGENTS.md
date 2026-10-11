# Architecture Companion — AGENTS.md

This document (`AGENTS.md`) records rules for coding agents only. Rules that both humans and coding agents must follow live in `CONTRIBUTING.md`. Read `CONTRIBUTING.md` first, before starting any work in this repository. The rules an agent must follow come from these two documents.

---

When working in this repository, do not invoke, load, or reference the installed `architecture-companion` skill. Use only the files in this repository as the source of truth. The only exception is when the user explicitly requests verification of the installed skill.

Apply AHA Programming (Avoiding Hasty Abstractions) when creating new files. Do not carry over implicit file-splitting habits from workflows where people wrote the code themselves. Splitting code into separate files is not, by itself, a design improvement or a means of abstraction. Code may be AI-written, but understanding it remains a human responsibility. When AI scatters related code across files, people must reconstruct the dependencies, making code flow, responsibilities, and the impact of changes harder to grasp. AI can readily analyze and modify thousands of lines of code, so it is much easier to keep code that needs to be understood and changed together in the same file by default, then refactor when a real need to split it arises. Splitting files requires explicit user direction, a sound basis such as dependency boundaries, or, even without clear supporting evidence, the agent's own specific, well-reasoned rationale grounded in roles and responsibilities. Do not split files based solely on size or convention. When the same code is needed in multiple files, first determine whether it is accidental duplication—code that merely looks the same—or code that serves the same roles and responsibilities and must change together.

Do not split formatting into a check step and a fix step. If you intend to fix formatting, run `pnpm format` (`prettier --write`) from the start instead of checking first and fixing after. Run `pnpm format:check` (`prettier --check`) only when you report the status without fixing anything. However a formatting error is discovered, resolve it with the formatter, never by hand.

If Prettier and Oxlint rules conflict and fixes fall into an infinite loop, follow Prettier, the source of truth for formatting. Ignore the remaining Oxlint errors and report that they need resolution; whether to report immediately or after finishing the current work follows the user's existing instructions.

The lefthook pre-commit hook formats staged files automatically at commit time, so do not manually verify or fix formatting for changes that will be committed.

Keep the auto-generated files of the distribution (`skills/architecture-companion/{runtime,schemas}`) in commits separate from source changes. If a rebase or anything else reorders commits, dropping only those commits lets the remaining changes apply without conflicts, and the generated files can simply be regenerated and committed afterwards.
