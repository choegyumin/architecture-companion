import { fileURLToPath } from "node:url";

const noRestrictedSyntax = {
  meta: {
    schema: [
      {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            selector: { type: "string" },
            message: { type: "string" },
          },
          required: ["selector", "message"],
        },
      },
    ],
  },
  create(context) {
    const [entries = []] = context.options;

    return Object.fromEntries(
      entries.map(({ selector, message }) => [selector, (node) => context.report({ node, message })]),
    );
  },
};

const repoPlugin = {
  name: "repo",
  specifier: fileURLToPath(import.meta.url),
};

export { repoPlugin };

export default {
  meta: { name: "repo" },
  rules: { "no-restricted-syntax": noRestrictedSyntax },
};
