import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "@/server/create-app";
import { ARTIFACT_RELATIVE_PATH } from "@/server/read-artifact";
import { resolveConsumerScope } from "@/server/resolve-consumer-scope";

const baseUrl = "http://architecture-companion.test";

function artifact(title: string) {
  return {
    version: 1,
    processes: [
      {
        title: "Workflow",
        generatorId: "freeform",
        layout: { id: "elk-layered", options: { direction: "RIGHT" } },
        graph: {
          groups: [],
          nodes: [{ type: "default", id: "submit", kind: "trigger", title }],
          edges: [],
        },
        id: "checkout",
      },
    ],
    designs: [],
  };
}

describe("artifact revision", () => {
  it("keeps the revision ID stable across reads and changes it when the artifact changes", async () => {
    const scopePath = await mkdtemp(join(tmpdir(), "architecture-companion-revision-"));

    try {
      await mkdir(join(scopePath, ".architecture-companion"));
      await writeFile(join(scopePath, ARTIFACT_RELATIVE_PATH), JSON.stringify(artifact("Checkout requested")));
      const app = createApp(await resolveConsumerScope(scopePath));

      const first = await (await app.request(`${baseUrl}/api/review`)).json();
      const repeated = await (await app.request(`${baseUrl}/api/review`)).json();
      await writeFile(join(scopePath, ARTIFACT_RELATIVE_PATH), JSON.stringify(artifact("Checkout started")));
      const changed = await (await app.request(`${baseUrl}/api/review`)).json();

      expect(first.artifactRevisionId).toMatch(/^[a-f0-9]{64}$/);
      expect(repeated.artifactRevisionId).toBe(first.artifactRevisionId);
      expect(changed.artifactRevisionId).not.toBe(first.artifactRevisionId);
    } finally {
      await rm(scopePath, { recursive: true });
    }
  });
});
