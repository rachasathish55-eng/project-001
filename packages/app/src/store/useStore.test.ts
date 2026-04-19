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
    useStore.setState({
      nodes: [],
      edges: [],
      workers: [],
      workerStats: null,
      workerManager: null,
      connectionState: "disconnected",
      terminalEntries: [],
    });
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

  it("appends output and stores worker stats", () => {
    const node = createNode("node-1");
    useStore.getState().addNode(node);
    useStore.getState().appendOutput("node-1", "stdout", "hello");
    useStore.getState().appendOutput("node-1", "stderr", "oops");
    useStore.getState().setWorkerStats({
      ts: 123,
      cpuPct: 42,
      memPct: 17,
      gpuPct: 9,
      workerId: "worker-1",
      hostname: "worker-host",
      os: "Linux 6.8",
      lastHeartbeatAt: 456,
    });
    useStore.getState().setConnectionState("connected");

    expect(useStore.getState().nodes[0]).toEqual(
      expect.objectContaining({
        lastOutput: "hello",
        lastError: "oops",
      }),
    );
    expect(useStore.getState().workerStats).toEqual({
      ts: 123,
      cpuPct: 42,
      memPct: 17,
      gpuPct: 9,
      workerId: "worker-1",
      hostname: "worker-host",
      os: "Linux 6.8",
      lastHeartbeatAt: 456,
    });
    expect(useStore.getState().connectionState).toBe("connected");
  });

  it("tracks worker records and offline state", () => {
    useStore.getState().upsertWorker({
      id: "worker-1",
      url: "ws://localhost:7331",
      ts: 10,
      cpuPct: 15,
      memPct: 20,
      gpuPct: null,
      workerId: "worker-1",
      hostname: "worker-1.local",
      os: "Linux",
      lastHeartbeatAt: 10,
      status: "online",
      pid: 42,
      version: "1.0.0",
    });

    useStore.getState().markWorkerOffline("worker-1");

    expect(useStore.getState().workers).toEqual([
      expect.objectContaining({
        id: "worker-1",
        url: "ws://localhost:7331",
        hostname: "worker-1.local",
        os: "Linux",
        status: "offline",
      }),
    ]);
  });

  it("stores terminal entries with a fixed capacity", () => {
    useStore.getState().appendTerminalEntries([
      {
        id: "terminal-1",
        ts: 1,
        stream: "stdout",
        text: "hello",
        nodeId: "node-1",
        nodeName: "Node 1",
      },
    ]);

    expect(useStore.getState().terminalEntries).toEqual([
      expect.objectContaining({
        text: "hello",
        nodeName: "Node 1",
      }),
    ]);
  });

  it("runs the pipeline in topological order and stops on failure", async () => {
    const calls: string[] = [];
    const manager = {
      exec(nodeId: string, code: string, workerId?: string | null) {
        calls.push(nodeId);
        if (workerId) {
          calls.push(workerId);
        }
        useStore.getState().updateNodeStatus(nodeId, "running");
        queueMicrotask(() => {
          useStore.getState().updateNodeStatus(nodeId, nodeId === "node-a" ? "success" : "success");
        });
        return `${nodeId}-${code.length}`;
      },
    };

    useStore.setState({
      nodes: [
        createNode("node-a", { type: "script", code: "print('Hello')", assignedWorker: "worker-1" }),
        createNode("node-b", { type: "script", code: "print('World')" }),
      ],
      edges: [{ source: "node-a", target: "node-b" }],
      workers: [
        {
          id: "worker-1",
          url: "ws://localhost:7331",
          ts: 10,
          cpuPct: 15,
          memPct: 20,
          gpuPct: null,
          workerId: "worker-1",
          hostname: "worker-1.local",
          os: "Linux",
          lastHeartbeatAt: 10,
          status: "online",
          pid: 42,
          version: "1.0.0",
        },
      ],
      workerManager: manager,
    });

    await useStore.getState().runPipeline();

    expect(calls).toEqual(["node-a", "worker-1", "node-b", "worker-1"]);
    expect(useStore.getState().nodes.map((node) => node.status)).toEqual(["success", "success"]);
  });

  it("aborts the pipeline when a node fails", async () => {
    const calls: string[] = [];
    const manager = {
      exec(nodeId: string) {
        calls.push(nodeId);
        useStore.getState().updateNodeStatus(nodeId, "running");
        queueMicrotask(() => {
          useStore.getState().updateNodeStatus(nodeId, nodeId === "node-a" ? "error" : "success");
        });
        return `${nodeId}-command`;
      },
    };

    useStore.setState({
      nodes: [
        createNode("node-a", { type: "script", code: "print('Hello')" }),
        createNode("node-b", { type: "script", code: "print('World')" }),
      ],
      edges: [{ source: "node-a", target: "node-b" }],
      workerManager: manager,
      workers: [
        {
          id: "worker-1",
          url: "ws://localhost:7331",
          ts: 10,
          cpuPct: 15,
          memPct: 20,
          gpuPct: null,
          workerId: "worker-1",
          hostname: "worker-1.local",
          os: "Linux",
          lastHeartbeatAt: 10,
          status: "online",
          pid: 42,
          version: "1.0.0",
        },
      ],
    });

    await expect(useStore.getState().runPipeline()).rejects.toThrow("Pipeline aborted at node node-a: error");

    expect(calls).toEqual(["node-a"]);
    expect(useStore.getState().nodes.map((node) => node.status)).toEqual(["error", "idle"]);
  });

  it("drops the oldest terminal entries past the buffer limit", () => {
    useStore.getState().appendTerminalEntries(
      Array.from({ length: 1001 }, (_, index) => ({
        id: `terminal-${index}`,
        ts: index,
        stream: "stdout" as const,
        text: `line-${index}`,
      })),
    );

    expect(useStore.getState().terminalEntries).toHaveLength(1000);
    expect(useStore.getState().terminalEntries[0]?.text).toBe("line-1");
    expect(useStore.getState().terminalEntries.at(-1)?.text).toBe("line-1000");
  });
});

describe("topologicalSort", () => {
  it("sorts a simple chain", () => {
    const nodes = [createNode("a"), createNode("b"), createNode("c")];
    const edges = [{ source: "a", target: "b" }, { source: "b", target: "c" }];

    expect(topologicalSort(nodes, edges)).toEqual(["a", "b", "c"]);
  });

  it("sorts a branching DAG", () => {
    const nodes = [createNode("a"), createNode("b"), createNode("c"), createNode("d")];
    const edges = [
      { source: "a", target: "c" },
      { source: "b", target: "c" },
      { source: "c", target: "d" },
    ];

    expect(topologicalSort(nodes, edges)).toEqual(["a", "b", "c", "d"]);
  });
});
