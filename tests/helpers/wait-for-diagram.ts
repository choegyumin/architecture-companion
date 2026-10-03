import { act, waitFor, within } from "@testing-library/react";

export async function waitForDiagramReady(container: HTMLElement = document.body): Promise<void> {
  await waitFor(() => expect(within(container).queryByText("Laying out…")).not.toBeInTheDocument());
  // Layout completion precedes the canvas's queued viewport update.
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}
