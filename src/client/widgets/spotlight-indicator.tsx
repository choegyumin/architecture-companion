import { addEventListener } from "@base-ui/utils/addEventListener";
import { ChevronLeft, ChevronRight, Focus, X } from "lucide-react";
import { useEffect } from "react";

import type { ArtifactSpotlight } from "@/features/spotlight/spotlight";
import { MULTI_LINE_FIELD_SELECTORS, SINGLE_LINE_FIELD_SELECTORS } from "@/shared/browser/form";
import { Button } from "@/shared/react-ui/button";
import { Card } from "@/shared/react-ui/card";

const TEXT_FIELD_KEY_SELECTORS = `${SINGLE_LINE_FIELD_SELECTORS}, ${MULTI_LINE_FIELD_SELECTORS}`;

export type SpotlightController = Readonly<{
  spotlight: ArtifactSpotlight;
  stepIndex: number;
  onStepChange: (stepIndex: number) => void;
  onClose: () => void;
}>;

/**
 * The spotlight panel over the canvas's top-right corner. The control bar is
 * always present; the current step's caption expands below it when the agent
 * supplied one. Arrow keys move between steps unless the reviewer is typing.
 * Dismissal is deliberately the only way to clear an active spotlight: the
 * agent, not the reviewer, owns it.
 */
export function SpotlightIndicator({ spotlight, stepIndex, onStepChange, onClose }: SpotlightController) {
  const steps = spotlight.diagram.steps;
  const step = steps[stepIndex];
  const hasNavigation = steps.length > 1;
  const goesToPrevious = stepIndex > 0;
  const goesToNext = stepIndex < steps.length - 1;

  useEffect(() => {
    if (!goesToPrevious && !goesToNext) return;
    return addEventListener(document, "keydown", (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing || event.defaultPrevented) return;
      const previous = event.key === "ArrowLeft" && goesToPrevious;
      const next = event.key === "ArrowRight" && goesToNext;
      if (!previous && !next) return;
      if (event.target instanceof Element && event.target.matches(TEXT_FIELD_KEY_SELECTORS)) return;
      event.preventDefault();
      onStepChange(previous ? stepIndex - 1 : stepIndex + 1);
    });
  }, [goesToPrevious, goesToNext, stepIndex, onStepChange]);

  return (
    <Card
      aria-live="polite"
      className="absolute top-4 right-4 max-h-[50%] w-80 py-0"
      role="status"
      size="xs"
      variant="default"
    >
      <div className="flex items-center p-1.5">
        <Focus aria-hidden="true" className="mx-1 size-4 shrink-0 text-muted-foreground" />
        {hasNavigation ? (
          <>
            <Button
              aria-label="Previous step"
              className="-m-1.5"
              disabled={!goesToPrevious}
              onClick={() => onStepChange(stepIndex - 1)}
              size="icon-sm"
              variant="ghost"
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span className="px-0.5 text-xs text-muted-foreground tabular-nums">
              {stepIndex + 1}/{steps.length}
            </span>
            <Button
              aria-label="Next step"
              className="-m-1.5"
              disabled={!goesToNext}
              onClick={() => onStepChange(stepIndex + 1)}
              size="icon-sm"
              variant="ghost"
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </>
        ) : null}
        <Button
          aria-label="Close spotlight"
          className="-m-1.5 ml-auto"
          onClick={onClose}
          size="icon-sm"
          variant="ghost"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      {step?.caption ? <p className="min-h-0 shrink overflow-y-auto px-3 pb-3 text-sm">{step.caption}</p> : null}
    </Card>
  );
}
