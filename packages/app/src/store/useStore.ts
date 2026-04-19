import { create } from "zustand";
import type { StrawberryNode, StrawberryNodeStatus } from "@strawberry/shared";
import { appendTerminalLogEntries, type TerminalLogEntry } from "../lib/terminal-logs";
import { topologicalSort } from "./utils";

export interface PipelineWorkerManager {
  exec: (nodeId: string, code: string, workerId?: string | null) => string;
}

export interface WorkerStats {
  ts: number;
  cpuPct: number;
  memPct: number;
  gpuPct: number | null;
  workerId: string | null;
  hostname: string | null;
  os: string | null;
  lastHeartbeatAt: number | null;
}

export interface WorkerRecord extends WorkerStats {
  id: string;
  url: string;
  status: "online" | "offline" | "connecting" | "reconnecting";
  pid: number | null;
  version: string | null;
}

type EdgeLike = { source?: string; target?: string; from?: string; to?: string };

export interface StoreState {
  nodes: StrawberryNode[];
  edges: any[];
  workers: WorkerRecord[];
  workerStats: WorkerStats | null;
  workerManager: PipelineWorkerManager | null;
  connectionState: "disconnected" | "connecting" | "connected" | "reconnecting";
  terminalEntries: TerminalLogEntry[];
  addNode: (node: StrawberryNode) => void;
  updateNode: (id: string, updates: Partial<StrawberryNode>) => void;
  deleteNode: (id: string) => void;
  setNodes: (nodes: StrawberryNode[]) => void;
  setEdges: (edges: any[]) => void;
  updateNodeStatus: (id: string, status: StrawberryNodeStatus) => void;
  appendOutput: (id: string, stream: "stdout" | "stderr", chunk: string) => void;
  appendTerminalEntries: (entries: TerminalLogEntry[]) => void;
  clearTerminalEntries: () => void;
  setWorkerManager: (manager: PipelineWorkerManager | null) => void;
  runPipeline: () => Promise<void>;
  upsertWorker: (worker: WorkerRecord) => void;
  markWorkerOffline: (workerId: string) => void;
  setWorkerStats: (stats: WorkerStats) => void;
  setConnectionState: (state: StoreState["connectionState"]) => void;
}

const touchesNode = (edge: EdgeLike, nodeId: string) => edge.source === nodeId || edge.target === nodeId || edge.from === nodeId || edge.to === nodeId;
const appendChunk = (existing: string | null | undefined, chunk: string) => (existing && existing.length > 0 ? `${existing}${chunk}` : chunk);
const clampPercent = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0);
const normalizeNullableString = (value: string | null | undefined) => (typeof value === "string" && value.trim().length > 0 ? value : null);
const finalPipelineStatuses = new Set<StrawberryNodeStatus>(["success", "error", "stopped"]);
const activeWorkerStatuses = new Set<WorkerRecord["status"]>(["online", "connecting", "reconnecting"]);

const pickPrimaryWorker = (workers: WorkerRecord[]) => sortWorkers(workers).find((worker) => activeWorkerStatuses.has(worker.status)) ?? null;

function waitForNodeStatus(nodeId: string): Promise<StrawberryNodeStatus> {
  const currentStatus = useStore.getState().nodes.find((node) => node.id === nodeId)?.status;
  if (currentStatus && finalPipelineStatuses.has(currentStatus)) {
    return Promise.resolve(currentStatus);
  }

  return new Promise<StrawberryNodeStatus>((resolve) => {
    const unsubscribe = useStore.subscribe((state) => {
      const nextStatus = state.nodes.find((node) => node.id === nodeId)?.status;
      if (nextStatus && finalPipelineStatuses.has(nextStatus)) {
        unsubscribe();
        resolve(nextStatus);
      }
    });
  });
}

function createPipelineError(nodeId: string, status: StrawberryNodeStatus): Error {
  return new Error(`Pipeline aborted at node ${nodeId}: ${status}`);
}

const sortWorkers = (workers: WorkerRecord[]) =>
  [...workers].sort((left, right) => {
    const rank: Record<WorkerRecord["status"], number> = {
      online: 0,
      connecting: 1,
      reconnecting: 2,
      offline: 3,
    };

    if (rank[left.status] !== rank[right.status]) {
      return rank[left.status] - rank[right.status];
    }

    return left.hostname.localeCompare(right.hostname) || left.url.localeCompare(right.url) || left.id.localeCompare(right.id);
  });

export const useStore = create<StoreState>((set) => ({
  nodes: [],
  edges: [],
  workers: [],
  workerStats: null,
  workerManager: null,
  connectionState: "disconnected",
  terminalEntries: [],
  addNode: (node) =>
    set((state) => ({
      nodes: [...state.nodes, node],
    })),
  updateNode: (id, updates) =>
    set((state) => ({
      nodes: state.nodes.map((node) => (node.id === id ? { ...node, ...updates } : node)),
    })),
  deleteNode: (id) =>
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== id),
      edges: state.edges.filter((edge) => !touchesNode(edge as EdgeLike, id)),
    })),
  setNodes: (nodes) =>
    set(() => ({
      nodes,
    })),
  setEdges: (edges) =>
    set(() => ({
      edges,
    })),
  updateNodeStatus: (id, status) =>
    set((state) => ({
      nodes: state.nodes.map((node) => (node.id === id ? { ...node, status } : node)),
    })),
  appendOutput: (id, stream, chunk) =>
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== id) {
          return node;
        }

        if (stream === "stdout") {
          return {
            ...node,
            lastOutput: appendChunk(node.lastOutput, chunk),
          };
        }

        return {
          ...node,
          lastError: appendChunk(node.lastError, chunk),
        };
      }),
    })),
  appendTerminalEntries: (entries) =>
    set((state) => ({
      terminalEntries: appendTerminalLogEntries(state.terminalEntries, entries),
    })),
  clearTerminalEntries: () =>
    set(() => ({
      terminalEntries: [],
    })),
  setWorkerManager: (manager) =>
    set(() => ({
      workerManager: manager,
    })),
  runPipeline: async () => {
    const state = useStore.getState();
    const manager = state.workerManager;

    if (!manager) {
      throw new Error("Pipeline execution requires an active WorkerManager.");
    }

    const orderedNodeIds = topologicalSort(state.nodes, state.edges as EdgeLike[]);
    const nodesById = new Map(state.nodes.map((node) => [node.id, node] as const));
    const workersById = new Map<string, WorkerRecord>();
    for (const worker of state.workers) {
      workersById.set(worker.id, worker);
      workersById.set(worker.url, worker);
      if (worker.workerId) {
        workersById.set(worker.workerId, worker);
      }
    }

    for (const nodeId of orderedNodeIds) {
      const node = nodesById.get(nodeId);
      if (!node || (node.type !== "script" && node.type !== "model")) {
        continue;
      }

      useStore.getState().updateNodeStatus(nodeId, "queued");

      const assignedWorker = normalizeNullableString(node.assignedWorker);
      const targetWorker = assignedWorker ? workersById.get(assignedWorker) ?? null : pickPrimaryWorker(state.workers);
      if (!targetWorker) {
        const error = assignedWorker
          ? new Error(`Assigned worker ${assignedWorker} is not connected.`)
          : new Error("No connected worker is available for pipeline execution.");
        useStore.getState().updateNode(nodeId, {
          status: "error",
          lastError: error.message,
        });
        throw error;
      }

      try {
        manager.exec(nodeId, node.code, targetWorker.id);
      } catch (error) {
        useStore.getState().updateNodeStatus(nodeId, "error");
        throw error;
      }

      const finalStatus = await waitForNodeStatus(nodeId);
      if (finalStatus !== "success") {
        throw createPipelineError(nodeId, finalStatus);
      }
    }
  },
  upsertWorker: (worker) =>
    set((state) => {
      const existingIndex = state.workers.findIndex((entry) => entry.id === worker.id);
      const existing = existingIndex >= 0 ? state.workers[existingIndex] : undefined;
      const nextWorker: WorkerRecord = {
        ...existing,
        ...worker,
        id: worker.id,
        url: normalizeNullableString(worker.url) ?? existing?.url ?? worker.id,
        hostname: normalizeNullableString(worker.hostname) ?? existing?.hostname ?? worker.id,
        os: normalizeNullableString(worker.os) ?? existing?.os ?? "Unknown OS",
        workerId: normalizeNullableString(worker.workerId) ?? existing?.workerId ?? worker.id,
        status: worker.status,
        cpuPct: clampPercent(worker.cpuPct),
        memPct: clampPercent(worker.memPct),
        gpuPct: worker.gpuPct === null ? null : clampPercent(worker.gpuPct),
        lastHeartbeatAt: worker.lastHeartbeatAt ?? existing?.lastHeartbeatAt ?? null,
        pid: worker.pid ?? existing?.pid ?? null,
        version: normalizeNullableString(worker.version) ?? existing?.version ?? null,
      };

      const workers =
        existingIndex >= 0
          ? state.workers.map((entry, index) => (index === existingIndex ? nextWorker : entry))
          : [...state.workers, nextWorker];

      return {
        workers: sortWorkers(workers),
      };
    }),
  markWorkerOffline: (workerId) =>
    set((state) => ({
      workers: sortWorkers(
        state.workers.map((worker) =>
          worker.id === workerId || worker.workerId === workerId || worker.url === workerId
            ? {
                ...worker,
                status: "offline",
              }
            : worker,
        ),
      ),
    })),
  setWorkerStats: (stats) =>
    set(() => ({
      workerStats: stats,
    })),
  setConnectionState: (state) =>
    set(() => ({
      connectionState: state,
    })),
}));
