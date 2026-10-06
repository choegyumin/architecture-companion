import type { RouteConditionChange } from "@/client/widgets/component-structure-route-conditions";

// The hover preview for one route: what would have to change to run the
// route's rule, stated as before → after per control and grouped under the
// component that owns each control. An empty list means the route already
// holds.
export function RouteDiffCard({ changes }: Readonly<{ changes: readonly RouteConditionChange[] }>) {
  if (changes.length === 0) {
    return (
      <div className="flex flex-col gap-1.5 text-xs">
        <p className="font-semibold text-muted-foreground">To run this route</p>
        <p className="text-muted-foreground">This route already holds.</p>
      </div>
    );
  }

  const groups = new Map<string, RouteConditionChange[]>();
  for (const change of changes) {
    const known = groups.get(change.ownerLabel);
    if (known) known.push(change);
    else groups.set(change.ownerLabel, [change]);
  }

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <p className="font-semibold text-muted-foreground">To run this route</p>
      {[...groups].map(([ownerLabel, owned]) => (
        <section key={ownerLabel}>
          <h4 className="font-medium text-muted-foreground">{ownerLabel}</h4>
          <ul className="flex flex-col gap-1">
            {owned.map((change) => (
              <li className="flex items-baseline justify-between gap-2" key={change.controlId}>
                <span className="truncate">{change.label}</span>
                <span className="shrink-0 font-mono">
                  {change.before} <span aria-hidden="true">→</span> {change.after}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
