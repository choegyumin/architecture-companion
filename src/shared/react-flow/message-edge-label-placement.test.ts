import { getMessageEdgeLabelPlacement } from "@/shared/react-flow/message-edge-label-placement";

describe("message edge label placement", () => {
  it("places a regular message label centered over the path", () => {
    expect(
      getMessageEdgeLabelPlacement(
        [
          { x: 100, y: 200 },
          { x: 300, y: 200 },
        ],
        false,
      ),
    ).toEqual({ x: 200, y: 188, transform: "translate(-50%, -100%)" });
  });

  it("places a self-message label centered over the loop's outer edge", () => {
    expect(
      getMessageEdgeLabelPlacement(
        [
          { x: 100, y: 200 },
          { x: 180, y: 200 },
          { x: 180, y: 228 },
          { x: 100, y: 228 },
        ],
        true,
      ),
    ).toEqual({ x: 180, y: 188, transform: "translate(-50%, -100%)" });
  });
});
