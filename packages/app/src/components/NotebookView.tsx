import type { StrawberryNode } from "@strawberry/shared";
import CodeCell from "./CodeCell";
import { useStore } from "../store/useStore";

function createScriptNode(index: number): StrawberryNode {
  const suffix = index + 1;
  return {
    id: `script-${Date.now()}-${suffix}`,
    type: "script",
    name: `Script ${suffix}`,
    code: "",
    language: "python",
    inputs: [],
    outputs: [],
    position: {
      x: 0,
      y: index * 220,
    },
    status: "idle" as const,
    lastOutput: null,
    lastError: null,
    runDuration: null,
    assignedWorker: null,
  };
}

export default function NotebookView() {
  const nodes = useStore((state) => state.nodes);
  const addNode = useStore((state) => state.addNode);

  const handleAddNode = () => {
    addNode(createScriptNode(nodes.length));
  };

  return (
    <section className="notebook-view">
      <header className="notebook-view__header">
        <div>
          <span className="notebook-view__eyebrow">Notebook</span>
          <h2 className="notebook-view__title">Vertical script cells</h2>
          <p className="notebook-view__description">
            Edit Python cells in order, run them against the worker daemon, and keep each node's output in sync.
          </p>
        </div>

        <button type="button" className="notebook-view__add" onClick={handleAddNode}>
          Add script node
        </button>
      </header>

      <div className="notebook-view__list">
        {nodes.length === 0 ? (
          <div className="notebook-view__empty">
            <strong>No script nodes yet</strong>
            <span>Add a cell to start building the notebook.</span>
          </div>
        ) : (
          nodes.map((node) => <CodeCell key={node.id} nodeId={node.id} />)
        )}
      </div>
    </section>
  );
}
