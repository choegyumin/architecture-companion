import type { ArtifactSpotlight } from "@/features/spotlight/spotlight";

type SpotlightListener = (spotlight: ArtifactSpotlight | null) => void;

export type SpotlightChannel = Readonly<{
  current: () => ArtifactSpotlight | null;
  publish: (spotlight: ArtifactSpotlight | null) => void;
  subscribe: (listener: SpotlightListener) => () => void;
}>;

export function createSpotlightChannel(): SpotlightChannel {
  let listeners: readonly SpotlightListener[] = [];
  let currentSpotlight: ArtifactSpotlight | null = null;

  return {
    current: () => currentSpotlight,
    publish: (spotlight) => {
      currentSpotlight = spotlight;
      listeners.forEach((listener) => listener(spotlight));
    },
    subscribe: (listener) => {
      listeners = [...listeners, listener];
      return () => {
        listeners = listeners.filter((candidate) => candidate !== listener);
      };
    },
  };
}
