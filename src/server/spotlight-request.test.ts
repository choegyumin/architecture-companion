import { isSpotlightRequestAllowed } from "@/server/spotlight-request";

describe("isSpotlightRequestAllowed", () => {
  const requestOrigin = "http://architecture-companion.test";

  it("allows local tooling requests that carry no browser headers", () => {
    expect(isSpotlightRequestAllowed({ origin: null, requestOrigin, fetchSite: null })).toBe(true);
  });

  it("allows the companion page itself", () => {
    expect(isSpotlightRequestAllowed({ origin: requestOrigin, requestOrigin, fetchSite: "same-origin" })).toBe(true);
  });

  it("rejects cross-site and foreign-origin requests", () => {
    expect(isSpotlightRequestAllowed({ origin: "https://example.com", requestOrigin, fetchSite: "cross-site" })).toBe(
      false,
    );
    expect(isSpotlightRequestAllowed({ origin: "https://example.com", requestOrigin, fetchSite: "same-site" })).toBe(
      false,
    );
  });
});
