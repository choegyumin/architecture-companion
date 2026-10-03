// React Flow needs browser measurements, which the simulated DOM does not provide.
export function installComponentDiagramBrowserMeasurements() {
  const observers = new Set<{ disconnect: () => void }>();
  class BrowserResizeObserver {
    private readonly callback: ResizeObserverCallback;
    private readonly timers = new Map<Element, ReturnType<typeof setTimeout>>();

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      observers.add(this);
    }

    observe(target: Element) {
      this.timers.set(
        target,
        setTimeout(() => {
          this.callback(
            [{ target, contentRect: { width: 1200, height: 800 } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
        }, 0),
      );
    }

    unobserve(target: Element) {
      clearTimeout(this.timers.get(target));
      this.timers.delete(target);
    }

    disconnect() {
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear();
      observers.delete(this);
    }
  }

  vi.stubGlobal("ResizeObserver", BrowserResizeObserver);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return Number.parseFloat(this.style.width) || 288;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return Number.parseFloat(this.style.height) || 400;
  });

  return () => {
    for (const observer of observers) observer.disconnect();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  };
}
