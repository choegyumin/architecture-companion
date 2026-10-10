import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { SpotlightIndicator } from "@/client/widgets/spotlight-indicator";
import type { ArtifactSpotlight } from "@/features/spotlight/spotlight";

function spotlight(steps: ArtifactSpotlight["diagram"]["steps"]): ArtifactSpotlight {
  return { artifactId: "checkout", diagram: { steps } };
}

function renderIndicator(
  spotlight: ArtifactSpotlight,
  stepIndex: number,
  handlers: { onStepChange: (stepIndex: number) => void; onClose: () => void } = {
    onStepChange: () => undefined,
    onClose: () => undefined,
  },
) {
  return render(<SpotlightIndicator spotlight={spotlight} stepIndex={stepIndex} {...handlers} />);
}

describe("SpotlightIndicator", () => {
  it("shows the caption and step position with working navigation", async () => {
    const user = userEvent.setup();
    const onStepChange = vi.fn();
    renderIndicator(
      spotlight([
        { elements: [], caption: "Agent posts the spotlight" },
        { elements: [], caption: "Server fans out over SSE" },
        { elements: [], caption: "Workspace applies emphasis" },
      ]),
      1,
      { onStepChange, onClose: () => undefined },
    );

    expect(screen.getByRole("status")).toHaveTextContent("Server fans out over SSE");
    expect(screen.getByRole("status")).toHaveTextContent("2/3");

    expect(screen.getByRole("button", { name: "Previous step" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Previous step" }));
    expect(onStepChange).toHaveBeenCalledWith(0);

    await user.click(screen.getByRole("button", { name: "Next step" }));
    expect(onStepChange).toHaveBeenCalledWith(2);
  });

  it("disables navigation at both ends", () => {
    const twoSteps = spotlight([{ elements: [] }, { elements: [] }]);

    const { unmount } = renderIndicator(twoSteps, 0);
    expect(screen.getByRole("button", { name: "Previous step" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next step" })).toBeEnabled();
    unmount();

    renderIndicator(twoSteps, 1);
    expect(screen.getByRole("button", { name: "Previous step" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next step" })).toBeDisabled();
  });

  it("hides navigation for a single step and shows only progress", () => {
    renderIndicator(spotlight([{ elements: [], caption: "Look here" }]), 0);

    expect(screen.getByRole("status")).toHaveTextContent("Look here");
    expect(screen.queryByRole("button", { name: "Previous step" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next step" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close spotlight" })).toBeInTheDocument();
  });

  it("closes the spotlight from its close button only", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderIndicator(spotlight([{ elements: [] }, { elements: [] }]), 0, {
      onStepChange: () => undefined,
      onClose,
    });

    await user.click(screen.getByRole("button", { name: "Close spotlight" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
