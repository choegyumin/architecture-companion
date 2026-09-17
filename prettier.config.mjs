/**
 * @see https://prettier.io/docs/configuration
 * @type {import("prettier").Config}
 */
const config = {
  printWidth: 120,
  semi: true,
  singleQuote: false,
  jsxSingleQuote: false,
  trailingComma: "all",
  overrides: [
    {
      files: ["*.json", "*.jsonc"],
      options: {
        trailingComma: "none",
      },
    },
  ],
};

export default config;
