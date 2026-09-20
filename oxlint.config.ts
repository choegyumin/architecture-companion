import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import pluginVitest from "@vitest/eslint-plugin";
import pluginBetterTailwindcss from "eslint-plugin-better-tailwindcss";
import { getDefaultSelectors } from "eslint-plugin-better-tailwindcss/defaults";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReactRefresh from "eslint-plugin-react-refresh";
import { defineConfig } from "oxlint";

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL(".", import.meta.url));

const pluginReactRules = Object.fromEntries(
  Object.entries(pluginReact.configs.flat.recommended.rules).map(([rule, config]) => [
    rule.replace(/^react\//, "react-js/"),
    config,
  ]),
);
const pluginReactHooksRules = Object.fromEntries(
  Object.entries(pluginReactHooks.configs.recommended.rules).map(([rule, config]) => [
    rule.replace(/^react-hooks\//, "react/"),
    config,
  ]),
);
const pluginVitestRules = Object.fromEntries(
  Object.entries(pluginVitest.configs.recommended.rules).map(([rule, config]) => [
    rule.replace(/^vitest\//, "vitest-js/"),
    config,
  ]),
);

// Construct RE2-safe DFA branches for forbidden substrings.
const reactExhaustiveDepsAdditionalHooks = (() => {
  const nonStart = "[^DMUW\\r\\n\\u2028\\u2029]";
  const mismatch = (expected: string) => `[^DMUW${expected}\\r\\n\\u2028\\u2029]${nonStart}*`;
  const safeAfter = (suffix: string) => {
    let expression = `(?:${mismatch(suffix.at(-1) ?? "")})?`;
    for (let index = suffix.length - 2; index >= 0; index -= 1) {
      const character = suffix[index];
      expression = `(?:${mismatch(character)}|${character}${expression})?`;
    }
    return expression;
  };
  const safeRun = `${nonStart}*(?:D${safeAfter("ebounce")}|M${safeAfter("ount")}|U${safeAfter("nmount")}|W${safeAfter("atch")})`;
  return `^use(?:${nonStart}+|${nonStart}*${safeRun}(?:${safeRun})*)(?:Callback|Effect)$`;
})();

const boundaryLayers = [
  {
    kind: "element",
    type: "shared-universal",
    pattern: "src/shared/universal",
    relationships: ["internal", "sibling"],
    dependencies: [],
  },
  {
    kind: "element",
    type: "shared-node",
    pattern: "src/shared/node",
    relationships: ["internal", "sibling"],
    dependencies: ["shared-universal"],
  },
  {
    kind: "element",
    type: "shared-browser",
    pattern: "src/shared/browser",
    relationships: ["internal", "sibling"],
    dependencies: ["shared-universal"],
  },
  {
    kind: "element",
    type: "shared-react",
    pattern: "src/shared/react",
    relationships: ["internal", "sibling"],
    dependencies: ["shared-browser", "shared-universal"],
  },
  {
    kind: "element",
    type: "shared-react-ui",
    pattern: "src/shared/react-ui",
    relationships: ["internal", "sibling"],
    dependencies: ["shared-react", "shared-browser", "shared-universal"],
  },
  {
    kind: "element",
    type: "shared-react-flow",
    pattern: "src/shared/react-flow",
    relationships: ["internal", "sibling"],
    dependencies: ["shared-react-ui", "shared-react", "shared-browser", "shared-universal"],
  },
  {
    kind: "element",
    type: "feature",
    pattern: "src/features",
    relationships: ["internal", "sibling"],
    dependencies: ["shared-universal"],
  },
  {
    kind: "element",
    type: "plugin",
    pattern: "src/plugins",
    relationships: ["internal", "sibling"],
    dependencies: ["feature", "shared-node", "shared-universal"],
  },
  {
    kind: "element",
    type: "cli",
    pattern: "src/cli",
    relationships: ["internal", "sibling"],
    dependencies: ["server", "feature", "shared-node", "shared-universal"],
  },
  {
    kind: "element",
    type: "server",
    pattern: "src/server",
    relationships: ["internal", "sibling"],
    dependencies: ["plugin", "feature", "shared-node", "shared-universal"],
  },
  {
    kind: "file",
    type: "client-data",
    pattern: "src/client/data-client.ts",
    dependencies: ["feature", "shared-browser", "shared-universal"],
  },
  {
    kind: "element",
    type: "client-part",
    pattern: "src/client/parts",
    relationships: ["internal", "sibling"],
    dependencies: [
      "plugin",
      "feature",
      "shared-react-flow",
      "shared-react-ui",
      "shared-react",
      "shared-browser",
      "shared-universal",
    ],
  },
  {
    kind: "element",
    type: "client-widget",
    pattern: "src/client/widgets",
    relationships: ["internal", "sibling"],
    dependencies: [
      "client-part",
      "client-data",
      "plugin",
      "feature",
      "shared-react-flow",
      "shared-react-ui",
      "shared-react",
      "shared-browser",
      "shared-universal",
    ],
  },
  {
    kind: "element",
    type: "client-page",
    pattern: "src/client/pages",
    relationships: ["internal"],
    dependencies: [
      "client-widget",
      "client-part",
      "client-data",
      "plugin",
      "feature",
      "shared-react-flow",
      "shared-react-ui",
      "shared-react",
      "shared-browser",
      "shared-universal",
    ],
  },
];
const boundaryKinds = Object.fromEntries(boundaryLayers.map(({ kind, type }) => [type, kind]));

export default defineConfig({
  categories: {
    correctness: "error",
  },
  ignorePatterns: [
    "**/node_modules",
    "**/patches",
    "**/.env",
    "**/.env.*",
    "**/.turbo",
    "**/build",
    "**/dist",
    "**/out",
    "**/.output",
    "**/coverage",
    "**/schema.json",
    "**/*.schema.json",
    "skills/architecture-companion/runtime",
  ],
  plugins: ["typescript", "unicorn", "import", "react"],
  jsPlugins: [
    {
      name: "simple-import-sort",
      specifier: require.resolve("eslint-plugin-simple-import-sort"),
    },
    {
      name: "turbo",
      specifier: require.resolve("eslint-plugin-turbo"),
    },
    {
      name: "boundaries",
      specifier: require.resolve("eslint-plugin-boundaries"),
    },
    {
      name: "react-js",
      specifier: require.resolve("eslint-plugin-react"),
    },
    {
      name: "react-refresh",
      specifier: require.resolve("eslint-plugin-react-refresh"),
    },
    {
      name: "better-tailwindcss",
      specifier: require.resolve("eslint-plugin-better-tailwindcss"),
    },
    {
      name: "vitest-js",
      specifier: require.resolve("@vitest/eslint-plugin"),
    },
    {
      name: "repo",
      specifier: fileURLToPath(new URL("./oxlint.plugin-repo.js", import.meta.url)),
    },
  ],
  settings: {
    react: { version: "19.0.0" },
    "better-tailwindcss": {
      entryPoint: "src/client/styles.css",
      selectors: [
        ...getDefaultSelectors(),
        {
          kind: "callee",
          name: "cns",
          match: [{ type: "strings" }],
        },
        {
          kind: "callee",
          name: "cns",
          match: [{ type: "objectKeys" }],
        },
      ],
    },
    "boundaries/root-path": packageRoot,
    "boundaries/include": ["src/**/*"],
    "boundaries/ignore": ["src/client/main.tsx", "src/**/*.spec.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    "boundaries/elements-single-match": false,
    "boundaries/elements": boundaryLayers
      .filter(({ kind }) => kind === "element")
      .flatMap(({ type, pattern }) => [
        { type, pattern: `${pattern}/*`, partialMatch: false },
        { type, pattern: `${pattern}/**`, partialMatch: false },
      ]),
    "boundaries/files": boundaryLayers
      .filter(({ kind }) => kind === "file")
      .map(({ type, pattern }) => ({ category: type, pattern })),
    "import/resolver": {
      oxc: {
        tsconfig: { configFile: "./tsconfig.json", references: "auto" },
      },
    },
  },
  env: {
    builtin: true,
    es2026: true,
    browser: true,
    serviceworker: false,
  },
  rules: {
    /* === base === */
    "no-empty": ["error", { allowEmptyCatch: true }],
    "simple-import-sort/imports": "error",
    "simple-import-sort/exports": "error",
    "turbo/no-undeclared-env-vars": "warn",
    "import/first": "error",
    "import/newline-after-import": "error",
    "import/no-cycle": ["error", { ignoreExternal: false, ignoreTypes: false }],
    "import/no-duplicates": "error",
    "unicorn/filename-case": [
      "error",
      {
        cases: {
          camelCase: true,
          kebabCase: true,
          pascalCase: true,
          snakeCase: false,
        },
        ignore: ["^.", "^_", "^-"],
      },
    ],
    "unicorn/no-instanceof-builtins": [
      "error",
      {
        strategy: "loose",
        exclude: ["Function"],
      },
    ],
    "unicorn/prefer-at": ["error", { checkAllIndexAccess: true }],
    "typescript/switch-exhaustiveness-check": [
      "error",
      {
        allowDefaultCaseForExhaustiveSwitch: false,
        considerDefaultExhaustiveForUnions: true,
        requireDefaultForNonUnion: true,
      },
    ],
    // Keep type-aware migration scoped to switch-exhaustiveness-check.
    // Correctness category also enables tsgolint rules, so disable its remaining rules explicitly.
    "typescript/await-thenable": "off",
    "typescript/consistent-return": "off",
    "typescript/consistent-type-exports": "off",
    "typescript/dot-notation": "off",
    "typescript/no-array-delete": "off",
    "typescript/no-base-to-string": "off",
    "typescript/no-confusing-void-expression": "off",
    "typescript/no-deprecated": "off",
    "typescript/no-duplicate-type-constituents": "off",
    "typescript/no-floating-promises": "off",
    "typescript/no-for-in-array": "off",
    "typescript/no-implied-eval": "off",
    "typescript/no-meaningless-void-operator": "off",
    "typescript/no-misused-promises": "off",
    "typescript/no-misused-spread": "off",
    "typescript/no-mixed-enums": "off",
    "typescript/no-redundant-type-constituents": "off",
    "typescript/no-unnecessary-boolean-literal-compare": "off",
    "typescript/no-unnecessary-condition": "off",
    "typescript/no-unnecessary-qualifier": "off",
    "typescript/no-unnecessary-template-expression": "off",
    "typescript/no-unnecessary-type-conversion": "off",
    "typescript/no-unnecessary-type-arguments": "off",
    "typescript/no-unnecessary-type-parameters": "off",
    "typescript/no-unnecessary-type-assertion": "off",
    "typescript/no-useless-default-assignment": "off",
    "typescript/no-unsafe-argument": "off",
    "typescript/no-unsafe-assignment": "off",
    "typescript/no-unsafe-call": "off",
    "typescript/no-unsafe-enum-comparison": "off",
    "typescript/no-unsafe-member-access": "off",
    "typescript/no-unsafe-return": "off",
    "typescript/no-unsafe-type-assertion": "off",
    "typescript/no-unsafe-unary-minus": "off",
    "typescript/non-nullable-type-assertion-style": "off",
    "typescript/only-throw-error": "off",
    "typescript/prefer-find": "off",
    "typescript/prefer-includes": "off",
    "typescript/prefer-optional-chain": "off",
    "typescript/prefer-nullish-coalescing": "off",
    "typescript/prefer-promise-reject-errors": "off",
    "typescript/prefer-readonly-parameter-types": "off",
    "typescript/prefer-regexp-exec": "off",
    "typescript/prefer-readonly": "off",
    "typescript/prefer-reduce-type-parameter": "off",
    "typescript/prefer-return-this-type": "off",
    "typescript/prefer-string-starts-ends-with": "off",
    "typescript/promise-function-async": "off",
    "typescript/related-getter-setter-pairs": "off",
    "typescript/require-array-sort-compare": "off",
    "typescript/require-await": "off",
    "typescript/restrict-plus-operands": "off",
    "typescript/restrict-template-expressions": "off",
    "typescript/return-await": "off",
    "typescript/strict-boolean-expressions": "off",
    "typescript/strict-void-return": "off",
    "typescript/unbound-method": "off",
    "typescript/use-unknown-in-catch-callback-variable": "off",

    /* === react === */
    ...pluginReactRules,
    ...pluginReactHooksRules,
    "react-js/react-in-jsx-scope": "off",
    "react/exhaustive-deps": ["error", { additionalHooks: reactExhaustiveDepsAdditionalHooks }],

    /* === react-vite === */
    ...pluginReactRefresh.configs.vite.rules,
    "react-refresh/only-export-components": [
      "warn",
      {
        allowConstantExport: true,
        extraHOCs: [
          "ErrorBoundary.with",
          "ErrorBoundaryGroup.with",
          "Suspense.with",
          "createSafeContext",
          "createFileRoute",
          "createLazyFileRoute",
          "createRootRoute",
          "createRootRouteWithContext",
          "createRoute",
          "createLazyRoute",
        ],
      },
    ],

    /* === tailwindcss === */
    ...pluginBetterTailwindcss.configs.recommended.rules,
    "better-tailwindcss/enforce-consistent-line-wrapping": "off",
    "better-tailwindcss/no-unknown-classes": "off",

    /* === vitest === */
    ...pluginVitestRules,
    "vitest-js/expect-expect": [
      "error",
      {
        assertFunctionNames: ["expect", "expectTypeOf"],
        additionalTestBlockFunctions: [],
      },
    ],

    /* === restricted === */
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "react",
            importNames: ["createContext"],
            message: "Use `createSafeContext` from `@/shared/react/safe-context` instead `react`.",
          },
          /*
          {
            name: "react",
            importNames: ["Suspense"],
            message: "Use `Suspense` from `@suspensive/react` instead `react`.",
          },
          */
        ],
      },
    ],
    "repo/no-restricted-syntax": [
      "error",
      [
        // {
        //   selector:
        //     "CallExpression[callee.type='MemberExpression'][callee.object.name='console'], CallExpression[callee.type='MemberExpression'][callee.object.type='MemberExpression'][callee.object.object.name='globalThis'][callee.object.property.name='console'], CallExpression[callee.type='MemberExpression'][callee.object.type='MemberExpression'][callee.object.object.name='window'][callee.object.property.name='console']",
        //   message: "Use `@repo/logger` instead of direct `console` calls.",
        // },
        {
          selector: "MemberExpression[object.name='React'][property.name='createContext']",
          message: "Use `createSafeContext` from `@/shared/react/safe-context` instead `React.createContext`.",
        },
        // {
        //   selector:
        //     "MemberExpression[object.name='React'][property.name='Suspense'], JSXMemberExpression[object.name='React'][property.name='Suspense']",
        //   message: "Use `Suspense` from `@suspensive/react` instead `React.Suspense`.",
        // },
      ],
    ],

    /* === layers-and-boundaries === */
    "boundaries/no-ignored-dependencies": "off",
    "boundaries/no-unknown-dependencies": "off",
    "boundaries/no-unknown-files": "error",
    "boundaries/no-private": "off",
    "boundaries/dependencies": [
      "error",
      {
        default: "disallow",
        checkAllOrigins: false,
        checkInternals:
          boundaryLayers.filter(
            ({ kind, relationships = [] }) => kind === "element" && !relationships.includes("internal"),
          ).length > 0,
        policies: boundaryLayers.flatMap(({ kind, type, relationships = [], dependencies: rawDependencies }) => {
          const elementDependencies = rawDependencies.filter((dependency) => boundaryKinds[dependency] === "element");
          const fileDependencies = rawDependencies.filter((dependency) => boundaryKinds[dependency] === "file");
          const dependencies = [
            ...(elementDependencies.length > 0 ? [{ element: { type: elementDependencies } }] : []),
            ...(fileDependencies.length > 0 ? [{ file: { categories: { anyOf: fileDependencies } } }] : []),
          ];
          const from = kind === "element" ? { element: { type } } : { file: { categories: type } };
          return [
            kind === "element" && {
              from,
              allow: {
                to: { element: { type } },
                dependency: { relationship: { to: relationships } },
              },
            },
            dependencies.length > 0 && {
              from,
              allow: { to: dependencies },
            },
          ].filter(Boolean);
        }),
      },
    ],
  },
  overrides: [
    {
      files: ["**/*.{ts,mts,cts,tsx}"],
      rules: {
        "no-unused-vars": [
          "error",
          {
            argsIgnorePattern: "^_",
            caughtErrorsIgnorePattern: "^_",
            destructuredArrayIgnorePattern: "^_",
            varsIgnorePattern: "^_",
          },
        ],
        "no-use-before-define": ["warn", { ignoreTypeReferences: true }],
        "typescript/ban-ts-comment": ["error", { "ts-ignore": "allow-with-description" }],
        "typescript/no-explicit-any": [
          "error",
          {
            fixToUnknown: false,
            ignoreRestArgs: true,
          },
        ],
      },
    },
    {
      files: ["**/*.d.ts"],
      rules: {
        "no-var": "off",
      },
    },
    {
      files: ["**/*.{spec,test}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"],
      rules: {
        "unicorn/no-null": "off",
      },
    },
    {
      files: ["**/*.config.{js,mjs,cjs,ts,mts,cts}"],
      rules: {
        "no-undef": "off",
        "unicorn/no-null": "off",
        "typescript/no-require-imports": "off",
      },
    },
    {
      files: ["**/*.{jsx,tsx}", "**/use*.{js,ts}"],
      rules: {
        "unicorn/no-null": "off",
      },
    },
    {
      files: ["**/*.spec.ts", "**/*.spec.tsx", "**/*.test.ts", "**/*.test.tsx"],
      env: {
        vitest: true,
      },
    },
  ],
  options: {
    typeAware: true,
  },
});
