import { act } from "@testing-library/react";
import { vi } from "vitest";

// React Flow's documented DOM-test setup: supply browser measurement APIs,
// not replacement renderers or event handlers. This does not emulate hit testing
// or pointer capture; those paths still require a real browser.
// https://reactflow.dev/learn/advanced-use/testing
export function installDiagramMeasurements(): () => void {
  const pending = new Set<ReturnType<typeof setTimeout>>();
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      private readonly timers = new Map<Element, ReturnType<typeof setTimeout>>();
      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(target: Element): void {
        this.unobserve(target);
        const timer = setTimeout(() => {
          this.timers.delete(target);
          pending.delete(timer);
          const bounds = target.getBoundingClientRect();
          const width = target instanceof HTMLElement ? target.offsetWidth : bounds.width;
          const height = target instanceof HTMLElement ? target.offsetHeight : bounds.height;
          const size = [{ inlineSize: width, blockSize: height }];
          act(() =>
            this.callback(
              [
                {
                  target,
                  contentRect: new DOMRect(bounds.x, bounds.y, width, height),
                  borderBoxSize: size,
                  contentBoxSize: size,
                  devicePixelContentBoxSize: size,
                },
              ],
              this,
            ),
          );
        }, 0);
        this.timers.set(target, timer);
        pending.add(timer);
      }

      unobserve(target: Element): void {
        const timer = this.timers.get(target);
        if (timer === undefined) return;
        clearTimeout(timer);
        pending.delete(timer);
        this.timers.delete(target);
      }

      disconnect(): void {
        for (const target of this.timers.keys()) this.unobserve(target);
      }
    },
  );
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      readonly m22: number;

      constructor(transform: string) {
        this.m22 = Number(transform?.match(/scale\(([\d.]+)/)?.at(1) ?? 1);
      }
    },
  );
  const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return Number.parseFloat(this.style.width) || 1;
  });
  const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return Number.parseFloat(this.style.height) || 1;
  });

  return () => {
    for (const timer of pending) clearTimeout(timer);
    width.mockRestore();
    height.mockRestore();
    vi.unstubAllGlobals();
  };
}
