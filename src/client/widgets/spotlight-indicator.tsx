import { ChevronLeft, ChevronRight, Focus, X } from "lucide-react";

import type { ArtifactSpotlight } from "@/features/spotlight/spotlight";
import { Button } from "@/shared/react-ui/button";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/shared/react-ui/item";

export type SpotlightController = Readonly<{
  spotlight: ArtifactSpotlight;
  stepIndex: number;
  onStepChange: (stepIndex: number) => void;
  onClose: () => void;
}>;

/**
 * The spotlight indicator pill. It names the current step, offers step
 * navigation, and dismisses the spotlight. Dismissal is deliberately the only
 * way to clear an active spotlight: the agent, not the reviewer, owns it.
 */
export function SpotlightIndicator({ spotlight, stepIndex, onStepChange, onClose }: SpotlightController) {
  const steps = spotlight.diagram.steps;
  const step = steps[stepIndex];
  const hasNavigation = steps.length > 1;

  return (
    <Item
      aria-live="polite"
      className="absolute top-4 left-1/2 w-fit -translate-x-1/2 rounded-full shadow-md"
      role="status"
      size="sm"
      variant="muted"
    >
      <ItemMedia variant="icon">
        <Focus aria-hidden="true" />
      </ItemMedia>
      {step?.caption ? (
        <ItemContent>
          <ItemTitle className="max-w-md">{step.caption}</ItemTitle>
        </ItemContent>
      ) : null}
      {hasNavigation ? (
        <ItemActions>
          <Button
            aria-label="Previous step"
            className="-m-1.5"
            disabled={stepIndex === 0}
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
            disabled={stepIndex >= steps.length - 1}
            onClick={() => onStepChange(stepIndex + 1)}
            size="icon-sm"
            variant="ghost"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </ItemActions>
      ) : null}
      <ItemActions>
        <Button aria-label="Close spotlight" className="-m-1.5 ml-0" onClick={onClose} size="icon-sm" variant="ghost">
          <X aria-hidden="true" />
        </Button>
      </ItemActions>
    </Item>
  );
}
