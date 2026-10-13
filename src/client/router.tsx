import { createRootRoute, createRoute, createRouter, type RouterHistory } from "@tanstack/react-router";
import { z } from "zod";

import type { DataClient } from "@/client/data-client";
import { WorkspacePage } from "@/client/pages/workspace-page";

export function createWorkspaceRouter(client: DataClient, history?: RouterHistory) {
  function WorkspaceRoute() {
    return <WorkspacePage client={client} />;
  }
  const rootRoute = createRootRoute({
    component: WorkspaceRoute,
    notFoundComponent: WorkspaceRoute,
    validateSearch: z.object({ q: z.string().optional().catch(undefined) }),
  });
  const artifactRoute = createRoute({ getParentRoute: () => rootRoute, path: "/artifacts/$" });
  return createRouter({
    routeTree: rootRoute.addChildren([artifactRoute]),
    history,
    // Search is URL text, not JSON: numeric and JSON-looking queries stay strings.
    parseSearch: (search) => Object.fromEntries(new URLSearchParams(search)),
    stringifySearch: (search) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(search)) {
        if (value !== undefined) params.set(key, String(value));
      }
      const encoded = params.toString();
      return encoded ? `?${encoded}` : "";
    },
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createWorkspaceRouter>;
  }
}
