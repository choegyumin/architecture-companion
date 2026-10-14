import "./styles.css";
import "@xyflow/react/dist/style.css";

import { RouterProvider } from "@tanstack/react-router";
import { OverlayProvider } from "overlay-kit";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createDataClient } from "@/client/data-client";
import { createWorkspaceRouter } from "@/client/router";
import { ThemeProvider } from "@/shared/react-ui/theme-provider";
import { Toaster } from "@/shared/react-ui/toast";

const rootElement = document.querySelector("#root");

if (!rootElement) throw new Error("Missing #root element.");

const router = createWorkspaceRouter(createDataClient(window.location.origin));

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider storageKey="architecture-companion-theme">
      <OverlayProvider>
        <RouterProvider router={router} />
        <Toaster />
      </OverlayProvider>
    </ThemeProvider>
  </StrictMode>,
);
