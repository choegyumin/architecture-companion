import type { Diagram } from "@/features/diagram/diagram";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/react-ui/card";
import { Item, ItemContent, ItemGroup, ItemTitle } from "@/shared/react-ui/item";

type DiagramListProps = Readonly<{
  activeDiagramId: string;
  diagrams: readonly Diagram[];
  heading: string;
  onSelect: (diagramId: string) => void;
}>;

export function DiagramList({ activeDiagramId, diagrams, heading, onSelect }: DiagramListProps) {
  return (
    <Card className="min-h-0 bg-surface" size="sm">
      <CardHeader>
        <CardTitle>{heading}</CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 overflow-y-auto">
        <ItemGroup aria-label={heading}>
          {diagrams.map((diagram) => {
            const isActive = diagram.id === activeDiagramId;

            return (
              <Item
                aria-current={isActive ? "page" : undefined}
                key={diagram.id}
                onClick={() => onSelect(diagram.id)}
                render={<button type="button" />}
                size="menu"
                variant={isActive ? "muted" : "default"}
              >
                <ItemContent>
                  <ItemTitle>{diagram.title}</ItemTitle>
                </ItemContent>
              </Item>
            );
          })}
        </ItemGroup>
      </CardContent>
    </Card>
  );
}
