import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": new URL("src", import.meta.url).pathname },
  },
  test: {
    testTimeout: process.env.CI === "true" ? 15_000 : 5_000,
    include: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
    exclude: ["node_modules", "**/__fixtures__/**", "dist", ".turbo"],
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.spec.ts",
        "**/*.spec.tsx",
        "src/client/main.tsx",
        "src/cli/serve.ts",
        "src/cli/validate-schemas.ts",
        "src/cli/view-annotations.ts",
        "src/cli/view-generators.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    typecheck: {
      enabled: true,
    },
    onConsoleLog: (message) => {
      // Frequent when using RTL with React v18-v19. Hide these logs until RTL handles the problem properly.
      // https://github.com/testing-library/react-testing-library/issues/1385
      // https://github.com/testing-library/react-testing-library/issues/1413
      if (message.startsWith("The current testing environment is not configured to support act")) return false;
      return true;
    },
  },
});
