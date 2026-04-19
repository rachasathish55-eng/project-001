import { create } from "zustand";
import type { StrawberryNode, StrawberryNodeStatus } from "@strawberry/shared";

type EdgeLike = { source?: string; target?: string; from?: string; to?: string };

export interface StoreState {
  nodes: StrawberryNode[];
  edges: any[];
  addNode: (node: StrawberryNode) => void;
  updateNode: (id: string, updates: Partial<StrawberryNode>) => void;
  deleteNode: (id: string) => void;
  setNodes: (nodes: StrawberryNode[]) => void;
  setEdges: (edges: any[]) => void;
  updateNodeStatus: (id: string, status: StrawberryNodeStatus) => void;
}

const touchesNode = (edge: EdgeLike, nodeId: string) => edge.source === nodeId || edge.target === nodeId || edge.from === nodeId || edge.to === nodeId;

export const useStore = create<StoreState>((set) => ({
  nodes: [],
  edges: [],
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
}));
