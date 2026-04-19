import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  addEdge,
  applyEdgeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
} from "reactflow";
import type { StrawberryNode as StrawberryNodeData } from "@strawberry/shared";
import StrawberryNode from "./StrawberryNode";
import { useStore } from "../../store/useStore";
import "reactflow/dist/style.css";

type StoredEdge = Partial<Edge> & {
  source?: string;
  target?: string;
  from?: string;
  to?: string;
};

const nodeTypes = {
  strawberry: StrawberryNode,
};

function normalizeStoredEdge(edge: StoredEdge, index: number): Edge | null {
  const source = edge.source ?? edge.from;
  const target = edge.target ?? edge.to;

  if (!source || !target) {
    return null;
  }

  return {
    ...edge,
    id: edge.id ?? `${source}-${target}-${index}`,
    source,
    target,
    type: edge.type ?? "smoothstep",
  };
}

function toFlowEdges(edges: any[]): Edge[] {
  return edges.flatMap((edge, index) => {
    const normalized = normalizeStoredEdge(edge, index);
    return normalized ? [normalized] : [];
  });
}

function toFlowNodes(nodes: StrawberryNodeData[]): Node<StrawberryNodeData>[] {
  return nodes.map((node) => ({
    id: node.id,
    type: "strawberry",
    position: node.position,
    data: node,
    selected: Boolean(node.metadata?.selected),
    draggable: true,
    selectable: true,
  }));
}

function createEdgeId(connection: Connection): string {
  const source = connection.source ?? "source";
  const target = connection.target ?? "target";
  const sourceHandle = connection.sourceHandle ?? "default";
  const targetHandle = connection.targetHandle ?? "default";
  return `${source}:${sourceHandle}->${target}:${targetHandle}-${Date.now()}`;
}

export default function Canvas() {
  const nodes = useStore((state) => state.nodes);
  const edges = useStore((state) => state.edges);
  const updateNode = useStore((state) => state.updateNode);
  const deleteNode = useStore((state) => state.deleteNode);
  const setEdges = useStore((state) => state.setEdges);
  const setActiveNodeId = useStore((state) => state.setActiveNodeId);
  const removalTimers = useRef(new Map<string, number>());

  const flowNodes = useMemo(() => toFlowNodes(nodes), [nodes]);
  const flowEdges = useMemo(() => toFlowEdges(edges), [edges]);

  useEffect(
    () => () => {
      for (const timer of removalTimers.current.values()) {
        window.clearTimeout(timer);
      }
      removalTimers.current.clear();
    },
    [],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === "remove") {
          const currentNode = nodes.find((entry) => entry.id === change.id);
          if (!currentNode) {
            deleteNode(change.id);
            continue;
          }

          if (removalTimers.current.has(change.id)) {
            continue;
          }

          updateNode(change.id, {
            metadata: {
              ...(currentNode.metadata ?? {}),
              exiting: true,
            },
          });

          const timer = window.setTimeout(() => {
            removalTimers.current.delete(change.id);
            deleteNode(change.id);
          }, 220);

          removalTimers.current.set(change.id, timer);
          continue;
        }

        if (change.type === "position" && change.position) {
          updateNode(change.id, { position: change.position });
          continue;
        }

        if (change.type === "select") {
          const node = nodes.find((entry) => entry.id === change.id);
          updateNode(change.id, {
            metadata: {
              ...(node?.metadata ?? {}),
              selected: change.selected,
            },
          });
          continue;
        }

        if (change.type === "dimensions" && change.dimensions) {
          updateNode(change.id, {
            width: change.dimensions.width,
            height: change.dimensions.height,
          });
        }
      }
    },
    [deleteNode, nodes, updateNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges(applyEdgeChanges(changes, toFlowEdges(useStore.getState().edges)));
    },
    [setEdges],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }

      const nextEdge: Edge = {
        ...connection,
        id: createEdgeId(connection),
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed },
      };

      setEdges(addEdge(nextEdge, toFlowEdges(useStore.getState().edges)));
    },
    [setEdges],
  );

  const onNodeClick = useCallback(
    (_event: unknown, node: Node<StrawberryNodeData>) => {
      setActiveNodeId(node.id);
    },
    [setActiveNodeId],
  );

  const onPaneClick = useCallback(() => {
    setActiveNodeId(null);
  }, [setActiveNodeId]);

  return (
    <div className="canvas-shell">
      <ReactFlowProvider>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          fitView
          snapToGrid
          snapGrid={[16, 16]}
          minZoom={0.35}
          maxZoom={1.75}
          defaultEdgeOptions={{
            type: "smoothstep",
            style: { stroke: "var(--accent)", strokeWidth: 2 },
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--border-color)" />
          <Controls />
          <MiniMap
            pannable
            zoomable
            className="canvas-shell__minimap"
            nodeColor={(node) => {
              const status = (node.data as StrawberryNodeData | undefined)?.status;
              if (status === "success") return "#34d399";
              if (status === "running") return "#60a5fa";
              if (status === "error") return "#fb7185";
              return "#7c4dff";
            }}
          />
          <Panel position="top-left">
            <div className="canvas-shell__panel">
              <span className="canvas-shell__panel-label">Editor</span>
              <strong>Drag, connect, and run notebook cells</strong>
            </div>
          </Panel>
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
