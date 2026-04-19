import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";
import NotebookCell from "./NotebookCell";
import { createScriptNode } from "../lib/node-templates";
import { useStore } from "../store/useStore";
import { topologicalSort } from "../store/utils";

export default function NotebookView() {
  const nodes = useStore((state) => state.nodes);
  const edges = useStore((state) => state.edges);
  const addNode = useStore((state) => state.addNode);
  const setActiveNodeId = useStore((state) => state.setActiveNodeId);

  const orderedNodes = useMemo(() => {
    if (edges.length === 0) {
      return [...nodes].sort(
        (left, right) => left.position.y - right.position.y || left.position.x - right.position.x || left.id.localeCompare(right.id),
      );
    }

    return topologicalSort(nodes, edges);
  }, [edges, nodes]);

  const handleAddNode = () => {
    const node = createScriptNode(nodes.length);
    addNode(node);
    setActiveNodeId(node.id);
  };

  return (
    <section className="notebook-view">
      <header className="notebook-view__header">
        <div>
          <span className="notebook-view__eyebrow">Notebook</span>
          <h2 className="notebook-view__title">Vertical script cells</h2>
          <p className="notebook-view__description">
            Edit Python cells in order, run them against the worker daemon, and keep each node&apos;s output in sync.
          </p>
        </div>

        <button type="button" className="notebook-view__add" onClick={handleAddNode}>
          Add script node
        </button>
      </header>

      <div className="notebook-view__list">
        {orderedNodes.length === 0 ? (
          <motion.div
            className="notebook-view__empty"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
          >
            <strong>No script nodes yet</strong>
            <span>Add a cell to start building the notebook.</span>
          </motion.div>
        ) : (
          <AnimatePresence initial={false} mode="popLayout">
            {orderedNodes.map((node) => (
              <motion.div
                key={node.id}
                layout
                initial={{ opacity: 0, y: 10, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
              >
                <NotebookCell nodeId={node.id} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </section>
  );
}
