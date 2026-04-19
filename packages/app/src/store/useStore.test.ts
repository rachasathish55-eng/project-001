import { beforeEach, describe, expect, it } from "vitest";
import type { StrawberryNode } from "@strawberry/shared";
import { useStore } from "./useStore";
import { topologicalSort } from "./utils";

function createNode(id: string, overrides: Partial<StrawberryNode> = {}): StrawberryNode {
  return {
    id,
    type: "node",
    name: id,
    code: "",
    language: "typescript",
    inputs: [],
    outputs: [],
    position: { x: 0, y: 0 },
    status: "idle",
    lastOutput: null,
    lastError: null,
    runDuration: null,
    assignedWorker: null,
    ...overrides,
  };
}

describe("useStore", () => {
  beforeEach(() => {
    useStore.setState({ nodes: [], edges: [] });
  });

  it("adds, updates, and deletes nodes", () => {
    const node = createNode("node-1");
    useStore.getState().addNode(node);
    useStore.getState().updateNode("node-1", { name: "updated", code: "print('ok')" });
    useStore.getState().updateNodeStatus("node-1", "running");

    expect(useStore.getState().nodes).toEqual([
      expect.objectContaining({
        id: "node-1",
        name: "updated",
        code: "print('ok')",
        status: "running",
      }),
    ]);

    useStore.setState({
      nodes: [node, createNode("node-2")],
      edges: [{ source: "node-1", target: "node-2" }],
    });

    useStore.getState().deleteNode("node-1");

    expect(useStore.getState().nodes.map((entry) => entry.id)).toEqual(["node-2"]);
    expect(useStore.getState().edges).toEqual([]);
  });

  it("replaces nodes and edges", () => {
    const nodes = [createNode("node-1"), createNode("node-2")];
    const edges = [{ source: "node-1", target: "node-2" }];

    useStore.getState().setNodes(nodes);
    useStore.getState().setEdges(edges);

    expect(useStore.getState().nodes).toEqual(nodes);
    expect(useStore.getState().edges).toEqual(edges);
  });
});

describe("topologicalSort", () => {
  it("sorts a simple chain", () => {
    const nodes = [createNode("a"), createNode("b"), createNode("c")];
    const edges = [{ source: "a", target: "b" }, { source: "b", target: "c" }];

    expect(topologicalSort(nodes, edges).map((node) => node.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts a branching DAG", () => {
    const nodes = [createNode("a"), createNode("b"), createNode("c"), createNode("d")];
    const edges = [
      { source: "a", target: "c" },
      { source: "b", target: "c" },
      { source: "c", target: "d" },
    ];

    expect(topologicalSort(nodes, edges).map((node) => node.id)).toEqual(["a", "b", "c", "d"]);
  });
});
