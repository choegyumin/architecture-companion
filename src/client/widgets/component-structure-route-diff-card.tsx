import type { RouteConditionChange } from "@/client/widgets/component-structure-route-conditions";

// The hover preview for one route: what would have to change to run the
// route's rule, stated as before → after per control. An empty list means the
// route already holds.
export function RouteDiffCard({ changes }: Readonly<{ changes: readonly RouteConditionChange[] }>) {
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      {changes.length === 0 ? (
        <p className="text-muted-foreground">This route already holds.</p>
      ) : (
        <>
          <p className="font-semibold text-muted-foreground">To run this route</p>
          <ul className="flex flex-col gap-1">
            {changes.map((change) => (
              <li className="flex items-baseline justify-between gap-2" key={change.controlId}>
                <span className="truncate">{change.label}</span>
                <span className="shrink-0 font-mono">
                  {change.before} <span aria-hidden="true">→</span> {change.after}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
