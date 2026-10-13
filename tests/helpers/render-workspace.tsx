import { createMemoryHistory, type RouterHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { OverlayProvider } from "overlay-kit";

import type { DataClient } from "@/client/data-client";
import { createWorkspaceRouter } from "@/client/router";

export async function renderWorkspace(
  client: DataClient,
  history: RouterHistory = createMemoryHistory({ initialEntries: ["/"] }),
) {
  const router = createWorkspaceRouter(client, history);
  await router.load();
  return {
    ...render(
      <OverlayProvider>
        <RouterProvider router={router} />
      </OverlayProvider>,
    ),
    router,
    history,
  };
}
