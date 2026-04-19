import { create } from "zustand";
import type { StrawberryNode, StrawberryNodeStatus } from "@strawberry/shared";
import { appendTerminalLogEntries, type TerminalLogEntry } from "../lib/terminal-logs";

export interface WorkerStats {
  ts: number;
  cpuPct: number;
  memPct: number;
  workerId: string | null;
  lastHeartbeatAt: number | null;
}

type EdgeLike = { source?: string; target?: string; from?: string; to?: string };

export interface StoreState {
  nodes: StrawberryNode[];
  edges: any[];
  workerStats: WorkerStats | null;
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
  setWorkerStats: (stats: WorkerStats) => void;
  setConnectionState: (state: StoreState["connectionState"]) => void;
}

const touchesNode = (edge: EdgeLike, nodeId: string) => edge.source === nodeId || edge.target === nodeId || edge.from === nodeId || edge.to === nodeId;
const appendChunk = (existing: string | null | undefined, chunk: string) => (existing && existing.length > 0 ? `${existing}${chunk}` : chunk);

export const useStore = create<StoreState>((set) => ({
  nodes: [],
  edges: [],
  workerStats: null,
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
  setWorkerStats: (stats) =>
    set(() => ({
      workerStats: stats,
    })),
  setConnectionState: (state) =>
    set(() => ({
      connectionState: state,
    })),
}));
