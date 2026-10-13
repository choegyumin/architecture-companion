import "@testing-library/jest-dom/vitest";

// Cases that render the workspace share happy-dom's URL, so a test that ends
// on an artifact stem would leak it into the next render. Reset to the root
// the way a fresh browser session starts.
afterEach(() => {
  // Node-environment suites have no window.
  globalThis.window?.history.replaceState(null, "", "/");
});
