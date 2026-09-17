type LocalAppActionRequest = Readonly<{
  action: string | null;
  expectedAction: string;
  origin: string | null;
  requestOrigin: string;
  fetchSite: string | null;
}>;

export function isLocalAppActionRequestAllowed(request: LocalAppActionRequest): boolean {
  if (request.action !== request.expectedAction) return false;
  if (request.fetchSite === "cross-site") return false;
  return request.origin === null || request.origin === request.requestOrigin;
}
