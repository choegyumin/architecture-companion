/** @type {import('@commitlint/types').UserConfig} */
const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat", // A new feature or changing existing behavior
        "fix", // A bug fix
        "perf", // A code change that improves performance
        "refactor", // A code change that neither fixes a bug nor adds a feature
        "rename", // File movement and renaming
        "format", // Code formatting changes or rules changes
        "test", // Adding missing tests or correcting existing tests
        "docs", // Documentation and comments only changes
        "bump", // Workspace(App) version updates
        "revert", // Reverting changes
      ],
    ],
    "scope-empty": [2, "never"],
    "scope-enum": [
      2,
      "always",
      [
        "cli", // `src/cli/`
        "client", // `src/client/`
        "features", // `src/features/`
        "plugins", // `src/plugins/`
        "server", // `src/server/`
        "shared", // `src/shared/`
        "artifacts", // `.architecture-companion/` (Dogfooding), `skills/architecture-companion/`
        "notes", // Changes to documentation (examples: `README.md`, `.agents/skills/`)
        "build", // Changes that affect the build system (examples: `vite.config.ts`, `scripts/`)
        "ci", // Changes to our CI configuration files and scripts (examples: GitHub Actions)
        "deps", // Changes external dependencies (examples: package.json dependencies)
      ],
    ],
    "body-max-line-length": [2, "always", 120],
  },
  defaultIgnores: true,
};

export default config;
