import { isLocalAppActionRequestAllowed } from "@/server/local-app-action-request";

type SourceOpenRequest = Readonly<{
  action: string | null;
  origin: string | null;
  requestOrigin: string;
  fetchSite: string | null;
}>;

export function isSourceOpenRequestAllowed(request: SourceOpenRequest): boolean {
  return isLocalAppActionRequestAllowed({ ...request, expectedAction: "open-source" });
}
