import type { ArtifactSpotlight } from "@/features/spotlight/spotlight";

type SpotlightListener = (spotlight: ArtifactSpotlight) => void;

/**
 * A one-shot spotlight fan-out. A published spotlight is handed to the
 * currently connected viewers once and is never stored or replayed, so a
 * browser that connects later sees nothing until the agent pings again.
 */
export type SpotlightBroadcasts = Readonly<{
  publish: (spotlight: ArtifactSpotlight) => void;
  subscribe: (listener: SpotlightListener) => () => void;
}>;

export function createSpotlightBroadcasts(): SpotlightBroadcasts {
  let listeners: readonly SpotlightListener[] = [];

  return {
    publish: (spotlight) => {
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
