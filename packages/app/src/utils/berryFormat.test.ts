import { beforeEach, describe, expect, it } from "vitest";
import type { StrawberryNode } from "@strawberry/shared";
import { useStore } from "../store/useStore";
import { applyBerryProject, createBerryArchive, createBerryProjectDocument, readBerryArchive } from "./berryFormat";

function createNode(id: string, overrides: Partial<StrawberryNode> = {}): StrawberryNode {
  return {
    id,
    type: "script",
    name: id,
    code: "",
    language: "python",
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

describe("berryFormat", () => {
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

  it("round-trips project state through a berry archive", async () => {
    useStore.setState({
      nodes: [
        createNode("script-1", {
          code: "print('hello')",
          status: "success",
          lastOutput: "hello\n",
          position: { x: 24, y: 48 },
        }),
        createNode("script-2", {
          code: "print('world')",
          status: "running",
          assignedWorker: "worker-1",
        }),
      ],
      edges: [{ id: "edge-1", source: "script-1", target: "script-2" }],
      workers: [
        {
          id: "worker-1",
          url: "ws://localhost:7331",
          ts: 123,
          cpuPct: 44.5,
          memPct: 17.25,
          gpuPct: null,
          workerId: "worker-1",
          hostname: "worker-1.local",
          os: "Linux",
          lastHeartbeatAt: 123,
        status: "online",
        pid: 42,
        version: "1.0.0",
      },
    ],
      workerStats: {
        ts: 123,
        cpuPct: 44.5,
        memPct: 17.25,
        gpuPct: null,
        workerId: "worker-1",
        hostname: "worker-1.local",
        os: "Linux",
        lastHeartbeatAt: 123,
      },
      connectionState: "connected",
      terminalEntries: [
        {
          id: "terminal-1",
          ts: 123,
          stream: "stdout",
          text: "hello",
          nodeId: "script-1",
          nodeName: "script-1",
          workerId: "worker-1",
        },
      ],
    });

    const archive = await createBerryArchive(createBerryProjectDocument("notebook"));
    const loaded = await readBerryArchive(archive);

    useStore.setState({
      nodes: [],
      edges: [],
      workers: [],
      workerStats: null,
      workerManager: null,
      connectionState: "disconnected",
      terminalEntries: [],
    });

    applyBerryProject(loaded);

    expect(loaded.workspace.viewMode).toBe("notebook");
    expect(useStore.getState().nodes).toEqual([
      expect.objectContaining({
        id: "script-1",
        code: "print('hello')",
        status: "success",
        lastOutput: "hello\n",
      }),
      expect.objectContaining({
        id: "script-2",
        code: "print('world')",
        status: "running",
        assignedWorker: "worker-1",
      }),
    ]);
    expect(useStore.getState().edges).toEqual([{ id: "edge-1", source: "script-1", target: "script-2" }]);
    expect(useStore.getState().workers).toEqual([
      expect.objectContaining({
        id: "worker-1",
        hostname: "worker-1.local",
        status: "online",
      }),
    ]);
    expect(useStore.getState().workerStats).toEqual(
      expect.objectContaining({
        cpuPct: 44.5,
        memPct: 17.25,
        workerId: "worker-1",
      }),
    );
    expect(useStore.getState().connectionState).toBe("connected");
    expect(useStore.getState().terminalEntries).toEqual([
      expect.objectContaining({
        text: "hello",
        nodeId: "script-1",
      }),
    ]);
  });
});
