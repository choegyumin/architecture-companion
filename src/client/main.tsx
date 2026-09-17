import "./styles.css";
import "@xyflow/react/dist/style.css";

import { OverlayProvider } from "overlay-kit";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createDataClient } from "@/client/data-client";
import { WorkspacePage } from "@/client/pages/workspace-page";
import { ThemeProvider } from "@/shared/react-ui/theme-provider";
import { Toaster } from "@/shared/react-ui/toast";

const rootElement = document.querySelector("#root");

if (!rootElement) throw new Error("Missing #root element.");

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider storageKey="architecture-companion-theme">
      <OverlayProvider>
        <WorkspacePage client={createDataClient(window.location.origin)} />
        <Toaster />
      </OverlayProvider>
    </ThemeProvider>
  </StrictMode>,
);
