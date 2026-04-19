import { AnimatePresence, motion } from "framer-motion";
import NotebookCell from "./NotebookCell";
import { useStore } from "../store/useStore";
import { createScriptNode } from "../lib/node-templates";

export default function NotebookView() {
  const nodes = useStore((state) => state.nodes);
  const addNode = useStore((state) => state.addNode);
  const setActiveNodeId = useStore((state) => state.setActiveNodeId);

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
            Edit Python cells in order, run them against the worker daemon, and keep each node's output in sync.
          </p>
        </div>

        <button type="button" className="notebook-view__add" onClick={handleAddNode}>
          Add script node
        </button>
      </header>

      <div className="notebook-view__list">
        {nodes.length === 0 ? (
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
            {nodes.map((node) => (
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
