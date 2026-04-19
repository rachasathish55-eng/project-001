import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StrawberryNode } from "@strawberry/shared";
import { useStore } from "../store/useStore";
import { WorkerManager } from "./worker-manager";

function createNode(id: string): StrawberryNode {
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
  };
}

class FakeSocket {
  public readyState = 0;
  public readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<(event: any) => void>>();

  addEventListener(type: string, listener: (event: any) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.dispatch("close", { reason: "closed" });
  }

  open(): void {
    this.readyState = 1;
    this.dispatch("open", {});
  }

  message(data: string): void {
    this.dispatch("message", { data });
  }

  private dispatch(type: string, event: any): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe("WorkerManager", () => {
  let socket: FakeSocket;
  let sockets: Map<string, FakeSocket>;
  let manager: WorkerManager;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = new Map();
    useStore.setState({
      nodes: [],
      edges: [],
      workers: [],
      workerStats: null,
      workerManager: null,
      connectionState: "disconnected",
      terminalEntries: [],
      activeNodeId: null,
    });
    useStore.getState().addNode(createNode("node-1"));
    manager = new WorkerManager({
      socketFactory: (url) => {
        const nextSocket = new FakeSocket();
        sockets.set(url, nextSocket);
        return nextSocket;
      },
      heartbeatIntervalMs: 5000,
      reconnectBaseDelayMs: 10,
      reconnectMaxDelayMs: 10,
    });
    socket = sockets.get("ws://localhost:7331") ?? new FakeSocket();
    socket.open();
  });

  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
  });

  it("sends exec commands and applies worker output", () => {
    const commandId = manager.exec("node-1", "print('ok')");
    expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toMatchObject({
      id: commandId,
      type: "command",
      command: "exec",
      data: {
        code: "print('ok')",
        node_id: "node-1",
      },
    });

    socket.message(JSON.stringify({ id: commandId, type: "stream", stream: "stdout", data: "hello\n" }));
    expect(useStore.getState().nodes[0]).toEqual(
      expect.objectContaining({
        status: "running",
        lastOutput: "hello\n",
      }),
    );
    expect(useStore.getState().terminalEntries.at(-1)).toEqual(
      expect.objectContaining({
        stream: "stdout",
        text: "hello",
        nodeId: "node-1",
      }),
    );

    socket.message(JSON.stringify({ id: commandId, type: "result", data: { script_id: "script-1", exit_code: 0 } }));
    expect(useStore.getState().nodes[0]).toEqual(
      expect.objectContaining({
        status: "success",
      }),
    );
  });

  it("tracks worker identity and telemetry", () => {
    socket.message(
      JSON.stringify({
        type: "identity",
        worker_id: "worker-1",
        hostname: "worker-host",
        os: "Linux 6.8",
        pid: 99,
        version: "1.2.3",
      }),
    );

    socket.message(
      JSON.stringify({
        type: "telemetry",
        ts: 123,
        cpu_pct: 31.2,
        mem_pct: 45.6,
        gpu_pct: 12.5,
      }),
    );

    expect(useStore.getState().workers).toEqual([
      expect.objectContaining({
        id: "ws://localhost:7331",
        url: "ws://localhost:7331",
        workerId: "worker-1",
        hostname: "worker-host",
        os: "Linux 6.8",
        status: "online",
        cpuPct: 31.2,
        memPct: 45.6,
        gpuPct: 12.5,
      }),
    ]);

    manager.connectWorker("ws://localhost:7332");
    const secondSocket = sockets.get("ws://localhost:7332");
    expect(secondSocket).toBeDefined();
    secondSocket?.open();
    secondSocket?.message(
      JSON.stringify({
        type: "identity",
        worker_id: "worker-2",
        hostname: "worker-host-2",
        os: "Linux 6.8",
        pid: 100,
        version: "1.2.4",
      }),
    );

    expect(useStore.getState().workers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ws://localhost:7331",
          hostname: "worker-host",
          status: "online",
        }),
        expect.objectContaining({
          id: "ws://localhost:7332",
          hostname: "worker-host-2",
          status: "online",
        }),
      ]),
    );
  });

  it("routes execution to the assigned worker connection", () => {
    manager.connectWorker("ws://localhost:7332");
    const secondSocket = sockets.get("ws://localhost:7332");
    expect(secondSocket).toBeDefined();
    secondSocket?.open();

    useStore.getState().updateNode("node-1", { assignedWorker: "ws://localhost:7332" });

    const commandId = manager.exec("node-1", "print('assigned')", "ws://localhost:7332");

    expect(socket.sent.every((entry) => JSON.parse(entry).command !== "exec")).toBe(true);
    const assignedCommand = secondSocket?.sent.map((entry) => JSON.parse(entry)).find((entry) => entry.command === "exec");
    expect(assignedCommand).toMatchObject({
      id: commandId,
      command: "exec",
      data: {
        node_id: "node-1",
        code: "print('assigned')",
      },
    });
  });

  it("sends heartbeats and handles disconnection", () => {
    vi.advanceTimersByTime(5000);
    expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toEqual({ type: "ping" });

    manager.exec("node-1", "print('still running')");
    socket.close();

    expect(useStore.getState().nodes[0]).toEqual(
      expect.objectContaining({
        status: "stopped",
        lastError: expect.stringContaining("Worker disconnected"),
      }),
    );
  });

  it("reconnects workers with exponential backoff and refreshes telemetry", () => {
    manager.dispose();
    useStore.setState({
      nodes: [],
      edges: [],
      workers: [],
      workerStats: null,
      workerManager: null,
      connectionState: "disconnected",
      terminalEntries: [],
      activeNodeId: null,
    });

    const initialSocket = new FakeSocket();
    const recoveredSocket = new FakeSocket();
    const socketFactoryCalls: Array<FakeSocket | null> = [];
    const outcomes = [initialSocket, null, null, recoveredSocket];
    const reconnectManager = new WorkerManager({
      socketFactory: () => {
        const nextSocket = outcomes.shift() ?? null;
        socketFactoryCalls.push(nextSocket);
        return nextSocket;
      },
      heartbeatIntervalMs: 5000,
      reconnectBaseDelayMs: 1000,
      reconnectMaxDelayMs: 60000,
    });
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    initialSocket.open();
    initialSocket.message(
      JSON.stringify({
        type: "identity",
        worker_id: "worker-1",
        hostname: "worker-host",
        os: "Linux 6.8",
        pid: 99,
        version: "1.2.3",
      }),
    );
    initialSocket.message(
      JSON.stringify({
        type: "telemetry",
        ts: 123,
        cpu_pct: 31.2,
        mem_pct: 45.6,
        gpu_pct: 12.5,
      }),
    );

    initialSocket.close();

    expect(useStore.getState().workers[0]).toEqual(
      expect.objectContaining({
        status: "reconnecting",
      }),
    );

    vi.advanceTimersByTime(999);
    expect(socketFactoryCalls).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(socketFactoryCalls).toHaveLength(2);

    vi.advanceTimersByTime(1999);
    expect(socketFactoryCalls).toHaveLength(2);

    vi.advanceTimersByTime(1);
    expect(socketFactoryCalls).toHaveLength(3);

    vi.advanceTimersByTime(3999);
    expect(socketFactoryCalls).toHaveLength(3);

    vi.advanceTimersByTime(1);
    expect(socketFactoryCalls).toHaveLength(4);

    recoveredSocket.open();
    const statusCommand = JSON.parse(recoveredSocket.sent.find((entry) => JSON.parse(entry).command === "get_status") ?? "{}");
    expect(statusCommand).toMatchObject({
      type: "request",
      command: "get_status",
    });

    const statusCommandId = statusCommand.id as string;
    recoveredSocket.message(
      JSON.stringify({
        type: "identity",
        worker_id: "worker-1",
        hostname: "worker-host",
        os: "Linux 6.8",
        pid: 101,
        version: "1.2.4",
      }),
    );
    recoveredSocket.message(
      JSON.stringify({
        id: statusCommandId,
        type: "result",
        data: {
          ts: 456,
          cpu_pct: 18.4,
          mem_pct: 21.7,
          gpu_pct: 2.5,
        },
      }),
    );

    expect(useStore.getState().workers).toEqual([
      expect.objectContaining({
        id: "ws://localhost:7331",
        status: "online",
        workerId: "worker-1",
        hostname: "worker-host",
        pid: 101,
        version: "1.2.4",
      }),
    ]);
    expect(useStore.getState().workerStats).toEqual(
      expect.objectContaining({
        cpuPct: 18.4,
        memPct: 21.7,
        gpuPct: 2.5,
        workerId: "worker-1",
        hostname: "worker-host",
      }),
    );
    expect(useStore.getState().connectionState).toBe("connected");
    expect(infoSpy.mock.calls.map((call) => call[0])).toEqual([
      expect.stringContaining("1000ms"),
      expect.stringContaining("2000ms"),
      expect.stringContaining("4000ms"),
    ]);

    infoSpy.mockRestore();
    reconnectManager.dispose();
  });
});
