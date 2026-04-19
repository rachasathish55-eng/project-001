import { motion } from "framer-motion";
import type { NodeProps } from "reactflow";
import { Handle, Position } from "reactflow";
import type { StrawberryNode as StrawberryNodeData } from "@strawberry/shared";
import WorkerAssignmentSelect from "../WorkerAssignmentSelect";

const statusLabels: Record<StrawberryNodeData["status"], string> = {
  idle: "Idle",
  queued: "Queued",
  running: "Running",
  success: "Success",
  error: "Error",
  stopped: "Stopped",
};

const languageLabels: Record<string, string> = {
  python: "Python",
  rust: "Rust",
  mojo: "Mojo",
};

function formatLanguage(language: string): string {
  return languageLabels[language.toLowerCase()] ?? language.slice(0, 1).toUpperCase() + language.slice(1);
}

export default function StrawberryNode({ data }: NodeProps<StrawberryNodeData>) {
  const status = data.status;

  return (
    <motion.article
      className={`strawberry-node strawberry-node--${status}`}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      <Handle type="target" position={Position.Left} className="strawberry-node__handle" />

      <header className="strawberry-node__header">
        <div className="strawberry-node__titles">
          <span className="strawberry-node__eyebrow">Notebook cell</span>
          <h3 className="strawberry-node__title">{data.name}</h3>
        </div>

        <motion.span
          className={`strawberry-node__status strawberry-node__status--${status}`}
          animate={
            status === "running"
              ? {
                  scale: [1, 1.04, 1],
                  opacity: [0.92, 1, 0.92],
                }
              : { scale: 1, opacity: 1 }
          }
          transition={
            status === "running"
              ? { duration: 1.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }
              : { duration: 0.15 }
          }
        >
          {statusLabels[status]}
        </motion.span>
      </header>

      <footer className="strawberry-node__footer">
        <span className="strawberry-node__language">{formatLanguage(data.language)}</span>
        <WorkerAssignmentSelect nodeId={data.id} value={data.assignedWorker} className="worker-select--node" />
      </footer>

      <Handle type="source" position={Position.Right} className="strawberry-node__handle" />
    </motion.article>
  );
}
