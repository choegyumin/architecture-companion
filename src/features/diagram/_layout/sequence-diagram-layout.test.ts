import { layoutSequenceDiagram } from "@/features/diagram/_layout/sequence-diagram-layout";
import type { DiagramGraph } from "@/features/diagram/diagram-graph";

function createSequenceDiagram({ nodes, edges }: Pick<DiagramGraph, "nodes" | "edges">): DiagramGraph {
  return { groups: [], nodes, edges };
}

describe("sequence diagram layout", () => {
  it("preserves lifeline order and routes messages with activation geometry", async () => {
    const diagram = createSequenceDiagram({
      nodes: [
        {
          id: "client",
          type: "lifeline",
          kind: "participant",
          title: "Client",
          activations: [
            {
              id: "client-work",
              startsAt: { messageId: "request", endpoint: "source" },
              endsAt: { messageId: "response", endpoint: "target" },
            },
          ],
        },
        {
          id: "server",
          type: "lifeline",
          kind: "participant",
          title: "Server",
          activations: [],
        },
      ],
      edges: [
        { id: "request", type: "message", source: "client", target: "server", messageType: "sync" },
        { id: "response", type: "message", source: "server", target: "client", messageType: "return" },
      ],
    });

    const result = await layoutSequenceDiagram(diagram, {
      client: { width: 160, height: 120 },
      server: { width: 160, height: 120 },
    });

    expect(result.nodes.map(({ id }) => id)).toEqual(["client", "server"]);
    expect(result.nodes.at(0)?.data).toMatchObject({
      handles: [
        { id: "request:source", side: "right" },
        { id: "response:target", side: "left" },
      ],
      activations: [{ id: "client-work" }],
    });
    expect(result.edges).toHaveLength(2);
    expect(result.edges.every(({ points }) => points.length >= 2)).toBe(true);
  });

  it("places sequence content below the tallest lifeline header", async () => {
    const tallestHeaderHeight = 280;
    const diagram = createSequenceDiagram({
      nodes: [
        {
          id: "client",
          type: "lifeline",
          kind: "participant",
          title: "Client",
          activations: [
            {
              id: "client-work",
              startsAt: { messageId: "request", endpoint: "source" },
              endsAt: { messageId: "request", endpoint: "source" },
            },
          ],
        },
        {
          id: "server",
          type: "lifeline",
          kind: "participant",
          title: "Server",
          activations: [],
        },
        {
          id: "validity",
          type: "fragment",
          kind: "condition",
          title: "Validity",
          operator: "opt",
          branches: [
            {
              id: "valid",
              guard: "valid",
              startMessageId: "request",
              endMessageId: "request",
            },
          ],
        },
      ],
      edges: [{ id: "request", type: "message", source: "client", target: "server", messageType: "sync" }],
    });

    const result = await layoutSequenceDiagram(diagram, {
      client: { width: 160, height: 120 },
      server: { width: 160, height: tallestHeaderHeight },
      validity: { width: 448, height: 160 },
    });
    const client = result.nodes.find(({ id }) => id === "client");
    const fragment = result.nodes.find(({ id }) => id === "validity");
    const message = result.edges.at(0);
    const clientData = client?.data;

    expect(message?.points.every(({ y }) => y > tallestHeaderHeight)).toBe(true);
    expect(clientData?.handles?.every(({ y }) => y > tallestHeaderHeight)).toBe(true);
    expect(clientData?.activations?.every(({ y }) => y > tallestHeaderHeight)).toBe(true);
    expect(fragment?.position.y).toBeGreaterThan(tallestHeaderHeight);
  });

  it("sizes each fragment to the message routes of its branches", async () => {
    const diagram = createSequenceDiagram({
      nodes: [
        { id: "first", type: "lifeline", kind: "participant", title: "First", activations: [] },
        { id: "second", type: "lifeline", kind: "participant", title: "Second", activations: [] },
        { id: "third", type: "lifeline", kind: "participant", title: "Third", activations: [] },
        { id: "fourth", type: "lifeline", kind: "participant", title: "Fourth", activations: [] },
        {
          id: "retry",
          type: "fragment",
          kind: "retry",
          title: "Retry",
          operator: "loop",
          branches: [
            {
              id: "retry-attempt",
              guard: "retry available",
              startMessageId: "inside",
              endMessageId: "inside",
            },
          ],
        },
      ],
      edges: [
        { id: "before", type: "message", source: "first", target: "fourth", messageType: "sync" },
        { id: "inside", type: "message", source: "second", target: "third", messageType: "sync" },
        { id: "after", type: "message", source: "first", target: "fourth", messageType: "sync" },
      ],
    });

    const result = await layoutSequenceDiagram(diagram, {
      first: { width: 160, height: 120 },
      second: { width: 160, height: 120 },
      third: { width: 160, height: 120 },
      fourth: { width: 160, height: 120 },
      retry: { width: 448, height: 160 },
    });

    const fragment = result.nodes.find(({ id }) => id === "retry");
    const message = result.edges.find(({ id }) => id === "inside");
    const branch = fragment?.data?.branches?.at(0);
    if (!fragment || !message || !branch || message.points.length < 2) {
      throw new Error("Expected fragment and message placement.");
    }

    const messageXs = message.points.map(({ x }) => x);
    const messageY = message.points.at(0)?.y;
    if (messageY === undefined) throw new Error("Expected message placement.");

    expect(fragment.position.x).toBeLessThan(Math.min(...messageXs));
    expect(fragment.position.x + fragment.size.width).toBeGreaterThan(Math.max(...messageXs));
    expect(fragment.position.y + branch.y).toBeLessThan(messageY);
    expect(fragment.position.y + branch.y + branch.height).toBeGreaterThan(messageY);
  });

  it("reserves vertical space before the first message of each fragment branch", async () => {
    const diagram = createSequenceDiagram({
      nodes: [
        { id: "client", type: "lifeline", kind: "participant", title: "Client", activations: [] },
        { id: "server", type: "lifeline", kind: "participant", title: "Server", activations: [] },
        {
          id: "result",
          type: "fragment",
          kind: "result",
          title: "Result",
          operator: "alt",
          branches: [
            { id: "success", guard: "success", startMessageId: "success", endMessageId: "success" },
            { id: "failure", guard: "failure", startMessageId: "failure", endMessageId: "failure" },
          ],
        },
      ],
      edges: [
        { id: "before", type: "message", source: "client", target: "server", messageType: "sync" },
        { id: "success", type: "message", source: "server", target: "client", messageType: "return" },
        { id: "failure", type: "message", source: "server", target: "client", messageType: "return" },
        { id: "after", type: "message", source: "client", target: "server", messageType: "sync" },
      ],
    });

    const result = await layoutSequenceDiagram(diagram, {
      client: { width: 160, height: 120 },
      server: { width: 160, height: 120 },
      result: { width: 448, height: 160 },
    });
    const getMessageY = (id: string) => {
      const y = result.edges.find((edge) => edge.id === id)?.points.at(0)?.y;
      if (y === undefined) throw new Error(`Expected message placement: ${id}`);
      return y;
    };
    const fragment = result.nodes.find(({ id }) => id === "result");
    const branches = fragment?.data?.branches;
    const successBranch = branches?.at(0);
    const failureBranch = branches?.at(1);
    if (!fragment || !successBranch || !failureBranch) throw new Error("Expected fragment branch placements.");

    const beforeY = getMessageY("before");
    const successY = getMessageY("success");
    const failureY = getMessageY("failure");
    const afterY = getMessageY("after");
    expect(beforeY).toBeLessThan(successY);
    expect(successY).toBeLessThan(failureY);
    expect(failureY).toBeLessThan(afterY);
    expect(successY - beforeY).toBeGreaterThan(afterY - failureY);
    expect(failureY - successY).toBeGreaterThan(afterY - failureY);
    expect(successY).toBeGreaterThan(fragment.position.y + successBranch.y);
    expect(successY).toBeLessThan(fragment.position.y + successBranch.y + successBranch.height);
    expect(failureY).toBeGreaterThan(fragment.position.y + failureBranch.y);
    expect(failureY).toBeLessThan(fragment.position.y + failureBranch.y + failureBranch.height);
  });

  it("keeps consecutive fragments from sharing a boundary", async () => {
    const diagram = createSequenceDiagram({
      nodes: [
        { id: "client", type: "lifeline", kind: "participant", title: "Client", activations: [] },
        { id: "server", type: "lifeline", kind: "participant", title: "Server", activations: [] },
        {
          id: "first-fragment",
          type: "fragment",
          kind: "condition",
          title: "First fragment",
          operator: "opt",
          branches: [{ id: "first-branch", guard: "first", startMessageId: "first", endMessageId: "first" }],
        },
        {
          id: "second-fragment",
          type: "fragment",
          kind: "condition",
          title: "Second fragment",
          operator: "opt",
          branches: [{ id: "second-branch", guard: "second", startMessageId: "second", endMessageId: "second" }],
        },
      ],
      edges: [
        { id: "first", type: "message", source: "client", target: "server", messageType: "sync" },
        { id: "second", type: "message", source: "client", target: "server", messageType: "sync" },
      ],
    });

    const result = await layoutSequenceDiagram(diagram, {
      client: { width: 160, height: 120 },
      server: { width: 160, height: 120 },
      "first-fragment": { width: 448, height: 160 },
      "second-fragment": { width: 448, height: 160 },
    });
    const first = result.nodes.find(({ id }) => id === "first-fragment");
    const second = result.nodes.find(({ id }) => id === "second-fragment");
    if (!first?.size || !second) throw new Error("Expected consecutive fragment placements.");

    expect(first.position.y + first.size.height).toBeLessThan(second.position.y);
  });

  it("extends a self-message to the lifeline gap and keeps the whole row below the loop", async () => {
    const diagram = createSequenceDiagram({
      nodes: [
        { id: "server", type: "lifeline", kind: "participant", title: "Server", activations: [] },
        { id: "worker", type: "lifeline", kind: "participant", title: "Worker", activations: [] },
      ],
      edges: [
        { id: "self", type: "message", source: "server", target: "server", messageType: "sync" },
        { id: "next", type: "message", source: "server", target: "worker", messageType: "sync" },
      ],
    });

    const result = await layoutSequenceDiagram(diagram, {
      server: { width: 160, height: 120 },
      worker: { width: 160, height: 120 },
    });
    const selfPoints = result.edges.at(0)?.points;
    const nextMessageY = result.edges.at(1)?.points.at(0)?.y;
    if (!selfPoints || selfPoints.length !== 4 || nextMessageY === undefined) {
      throw new Error("Expected self-message and following message placements.");
    }
    const [start, loopTop, loopBottom, end] = selfPoints;
    if (!start || !loopTop || !loopBottom || !end) throw new Error("Expected self-message path points.");

    expect(start.x).toBe(end.x);
    expect(start.y).toBe(loopTop.y);
    expect(loopTop.x).toBe(loopBottom.x);
    expect(loopBottom.y).toBe(end.y);
    expect(loopTop.x).toBeGreaterThan(start.x);
    expect(end.y).toBeGreaterThan(start.y);
    expect(nextMessageY).toBeGreaterThan(end.y);
  });
});
