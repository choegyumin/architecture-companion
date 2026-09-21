import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "@/server/create-app";
import { resolveConsumerScope } from "@/server/resolve-consumer-scope";
import { isSourceOpenRequestAllowed } from "@/server/source-open-request";
import { writeArtifact } from "@/server/write-artifact";

const baseUrl = "http://architecture-companion.test";

function artifact() {
  return {
    behaviors: [
      {
        id: "checkout",
        title: "Checkout workflow",
        generator: "built-in:freeform",
        layout: { id: "elk-layered" },
        graph: {
          groups: [],
          nodes: [{ type: "default", id: "submit", kind: "trigger", title: "Checkout requested" }],
          edges: [],
        },
      },
    ],
    designs: [
      {
        id: "structure",
        title: "Checkout structure",
        generator: "built-in:freeform",
        layout: { id: "elk-layered" },
        graph: {
          groups: [],
          nodes: [
            {
              type: "default",
              id: "checkout-page",
              kind: "component",
              title: "Checkout page",
              description: "Collect checkout input",
              details: ["Submit checkout"],
              links: [{ href: "source:///src/checkout-page.ts" }],
            },
          ],
          edges: [],
        },
      },
    ],
  };
}

async function postOpen(app: ReturnType<typeof createApp>, href: string, origin = baseUrl) {
  return app.request(`${baseUrl}/api/source/open`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": origin === baseUrl ? "same-origin" : "cross-site",
      "X-Architecture-Companion-Action": "open-source",
    },
    body: JSON.stringify({ href }),
  });
}

describe("source reference server", () => {
  it("opens a source href with a validated line range", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-source-"));
    const openedLocations: unknown[] = [];

    try {
      await mkdir(join(scopePath, "src"));
      await writeFile(join(scopePath, "src/workflow.ts"), "export const workflow = true;\n");
      await writeArtifact(scopePath, artifact());
      const scope = await resolveConsumerScope(scopePath);
      const app = createApp(scope, { openPath: async (location) => void openedLocations.push(location) });
      const href = "source:///src/workflow.ts#L42-L60";

      const response = await postOpen(app, href);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ opened: { href } });
      expect(openedLocations).toEqual([
        { path: await realpath(join(scopePath, "src/workflow.ts")), line: 42, endLine: 60 },
      ]);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("requires an editor adapter for line-specific opening with the default opener", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-source-"));

    try {
      await mkdir(join(scopePath, "src"));
      await writeFile(join(scopePath, "src/workflow.ts"), "export const workflow = true;\n");
      const scope = await resolveConsumerScope(scopePath);
      const app = createApp(scope);

      const response = await postOpen(app, "source:///src/workflow.ts#L42");

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: {
          message:
            "Could not open source file: src/workflow.ts. Line-specific source opening requires an editor adapter.",
        },
      });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("rejects malformed hrefs, missing files, and directories", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-source-"));

    try {
      await mkdir(join(scopePath, "src"));
      await writeArtifact(scopePath, artifact());
      const scope = await resolveConsumerScope(scopePath);
      const app = createApp(scope, { openPath: async () => undefined });

      const malformedResponse = await postOpen(app, "source:///src/workflow.ts#L60-L42");
      expect(malformedResponse.status).toBe(400);
      expect(await malformedResponse.json()).toEqual({
        error: { message: "Source href line range must end at or after its start." },
      });

      const missingResponse = await postOpen(app, "source:///src/workflow.ts");
      expect(missingResponse.status).toBe(404);
      expect(await missingResponse.json()).toEqual({
        error: { message: "Source file does not exist: src/workflow.ts" },
      });

      const directoryResponse = await postOpen(app, "source:///src");
      expect(directoryResponse.status).toBe(422);
      expect(await directoryResponse.json()).toEqual({ error: { message: "Source path is not a file: src" } });
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });

  it("allows same-origin requests and rejects cross-origin requests", () => {
    expect(
      isSourceOpenRequestAllowed({
        action: "open-source",
        origin: baseUrl,
        requestOrigin: baseUrl,
        fetchSite: "same-origin",
      }),
    ).toBe(true);
    expect(
      isSourceOpenRequestAllowed({
        action: "open-source",
        origin: "https://attacker.example",
        requestOrigin: baseUrl,
        fetchSite: "cross-site",
      }),
    ).toBe(false);
    expect(
      isSourceOpenRequestAllowed({ action: null, origin: baseUrl, requestOrigin: baseUrl, fetchSite: "same-origin" }),
    ).toBe(false);
  });

  it("rejects symlinks that resolve outside the review scope", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-source-"));
    const outsidePath = await mkdtemp(join(tmpdir(), "architecture-companion-outside-"));

    try {
      await mkdir(join(scopePath, "src"));
      await writeFile(join(outsidePath, "outside.ts"), "export const secret = true;\n");
      await symlink(join(outsidePath, "outside.ts"), join(scopePath, "src/link.ts"));
      await writeArtifact(scopePath, artifact());
      const scope = await resolveConsumerScope(scopePath);
      const app = createApp(scope, { openPath: async () => undefined });

      const response = await postOpen(app, "source:///src/link.ts");

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: { message: "Source path resolves outside the review scope." } });
    } finally {
      await rm(scopePath, { recursive: true });
      await rm(outsidePath, { recursive: true });
    }
  });

  it("rejects source-open requests without the local action header", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-source-"));

    try {
      await mkdir(join(scopePath, "src"));
      await writeFile(join(scopePath, "src/workflow.ts"), "export const workflow = true;\n");
      await writeArtifact(scopePath, artifact());
      const scope = await resolveConsumerScope(scopePath);
      const app = createApp(scope, { openPath: async () => undefined });
      const response = await app.request(`${baseUrl}/api/source/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ href: "source:///src/workflow.ts" }),
      });

      expect(response.status).toBe(403);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });
});
