type SpotlightRequest = Readonly<{
  origin: string | null;
  requestOrigin: string;
  fetchSite: string | null;
}>;

export function isSpotlightRequestAllowed(request: SpotlightRequest): boolean {
  // Spotlight requests come from local tooling such as a coding agent, which
  // sends no Origin header. Cross-site pages must not drive the viewer.
  if (request.fetchSite === "cross-site") return false;
  return request.origin === null || request.origin === request.requestOrigin;
}
