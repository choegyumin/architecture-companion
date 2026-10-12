import type { Artifact } from "@/features/artifact/artifact";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/react-ui/card";
import { Item, ItemContent, ItemGroup, ItemTitle } from "@/shared/react-ui/item";

type ArtifactListProps = Readonly<{
  activeArtifactId: string;
  artifacts: readonly Artifact[];
  heading: string;
  onSelect: (artifactId: string) => void;
}>;

export function ArtifactList({ activeArtifactId, artifacts, heading, onSelect }: ArtifactListProps) {
  return (
    <Card className="min-h-0 bg-surface" size="sm">
      <CardHeader>
        <CardTitle>{heading}</CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 overflow-y-auto">
        <ItemGroup aria-label={heading}>
          {artifacts.map((artifact) => {
            const isActive = artifact.artifactId === activeArtifactId;

            return (
              <Item
                aria-current={isActive ? "page" : undefined}
                key={artifact.artifactId}
                onClick={() => onSelect(artifact.artifactId)}
                render={<button type="button" />}
                size="menu"
                variant={isActive ? "muted" : "default"}
              >
                <ItemContent>
                  <ItemTitle>{artifact.title}</ItemTitle>
                </ItemContent>
              </Item>
            );
          })}
        </ItemGroup>
      </CardContent>
    </Card>
  );
}
