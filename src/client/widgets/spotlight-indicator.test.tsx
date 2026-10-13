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
    const twoSteps = spotlight([
      { elements: [], caption: "First" },
      { elements: [], caption: "Second" },
    ]);

    const { unmount } = renderIndicator(twoSteps, 0);
    expect(screen.getByRole("button", { name: "Previous step" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next step" })).toBeEnabled();
    unmount();

    renderIndicator(twoSteps, 1);
    expect(screen.getByRole("button", { name: "Previous step" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next step" })).toBeDisabled();
  });

  it("keeps a single step without navigation or a step count", () => {
    renderIndicator(spotlight([{ elements: [], caption: "Look here" }]), 0);

    expect(screen.getByRole("status")).toHaveTextContent("Look here");
    expect(screen.queryByRole("button", { name: "Previous step" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next step" })).not.toBeInTheDocument();
    expect(screen.queryByText("1/1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close spotlight" })).toBeInTheDocument();
  });

  it("puts a single-step caption inline with the controls", () => {
    renderIndicator(spotlight([{ elements: [], caption: "Look here" }]), 0);

    const captionRow = screen.getByText("Look here").parentElement;
    expect(captionRow).toContainElement(screen.getByRole("button", { name: "Close spotlight" }));
  });

  it("keeps a multi-step caption on its own row", () => {
    renderIndicator(
      spotlight([
        { elements: [], caption: "First" },
        { elements: [], caption: "Second" },
      ]),
      0,
    );

    const bar = screen.getByRole("button", { name: "Close spotlight" }).parentElement;
    expect(bar).not.toContainElement(screen.getByText("First"));
  });

  it("closes the spotlight from its close button only", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderIndicator(
      spotlight([
        { elements: [], caption: "First" },
        { elements: [], caption: "Second" },
      ]),
      0,
      {
        onStepChange: () => undefined,
        onClose,
      },
    );

    await user.click(screen.getByRole("button", { name: "Close spotlight" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves between steps with the arrow keys", async () => {
    const user = userEvent.setup();
    const onStepChange = vi.fn();
    renderIndicator(
      spotlight([
        { elements: [], caption: "First" },
        { elements: [], caption: "Second" },
        { elements: [], caption: "Third" },
      ]),
      1,
      {
        onStepChange,
        onClose: () => undefined,
      },
    );

    await user.keyboard("{ArrowRight}");
    expect(onStepChange).toHaveBeenLastCalledWith(2);

    await user.keyboard("{ArrowLeft}");
    expect(onStepChange).toHaveBeenLastCalledWith(0);
  });

  it("ignores arrow keys at the ends, with modifiers, and from text fields", async () => {
    const user = userEvent.setup();
    const onStepChange = vi.fn();
    render(
      <>
        <input aria-label="Search" />
        <textarea aria-label="Note" />
        <SpotlightIndicator
          spotlight={spotlight([
            { elements: [], caption: "First" },
            { elements: [], caption: "Second" },
          ])}
          stepIndex={0}
          onStepChange={onStepChange}
          onClose={() => undefined}
        />
      </>,
    );

    await user.keyboard("{ArrowLeft}");
    expect(onStepChange).not.toHaveBeenCalled();

    await user.keyboard("{ArrowRight}");
    expect(onStepChange).toHaveBeenLastCalledWith(1);

    await user.keyboard("{Meta>}{ArrowRight}{/Meta}");
    expect(onStepChange).toHaveBeenCalledTimes(1);

    const input = screen.getByLabelText("Search");
    await user.click(input);
    await user.keyboard("{ArrowRight}");
    expect(onStepChange).toHaveBeenCalledTimes(1);

    const note = screen.getByLabelText("Note");
    await user.click(note);
    await user.keyboard("{ArrowLeft}");
    expect(onStepChange).toHaveBeenCalledTimes(1);
  });
});
