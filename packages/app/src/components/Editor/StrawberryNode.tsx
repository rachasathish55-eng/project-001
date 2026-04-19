import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
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

const NODE_EXIT_DURATION_MS = 180;

function formatLanguage(language: string): string {
  return languageLabels[language.toLowerCase()] ?? language.slice(0, 1).toUpperCase() + language.slice(1);
}

export default function StrawberryNode({ data }: NodeProps<StrawberryNodeData>) {
  const status = data.status;
  const isExiting = Boolean(data.metadata?.exiting);
  const [isPresent, setIsPresent] = useState(true);

  useEffect(() => {
    if (!isExiting) {
      setIsPresent(true);
      return;
    }

    const timer = window.setTimeout(() => setIsPresent(false), NODE_EXIT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [isExiting]);

  return (
    <AnimatePresence initial={false}>
      {isPresent ? (
        <motion.article
          key={data.id}
          className={`strawberry-node strawberry-node--${status}${isExiting ? " strawberry-node--exiting" : ""}`}
          layout
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={
            isExiting
              ? { opacity: 0.35, y: -6, scale: 0.96 }
              : status === "running"
                ? {
                    opacity: 1,
                    y: 0,
                    scale: 1,
                    boxShadow: [
                      "0 24px 80px rgba(0, 0, 0, 0.45)",
                      "0 24px 96px rgba(96, 165, 250, 0.12)",
                      "0 24px 80px rgba(0, 0, 0, 0.45)",
                    ],
                  }
                : { opacity: 1, y: 0, scale: 1 }
          }
          exit={{ opacity: 0, y: -10, scale: 0.94 }}
          transition={
            status === "running"
              ? { duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }
              : { duration: 0.18, ease: "easeInOut" }
          }
        >
          <Handle type="target" position={Position.Left} className="strawberry-node__handle" />

          <header className="strawberry-node__header">
            <div className="strawberry-node__titles">
              <span className="strawberry-node__eyebrow">Notebook cell</span>
              <h3 className="strawberry-node__title">{data.name}</h3>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={status}
                className={`strawberry-node__status strawberry-node__status--${status}`}
                initial={{ opacity: 0, y: 4, scale: 0.96 }}
                animate={
                  status === "running"
                    ? {
                        opacity: [0.92, 1, 0.92],
                        scale: [1, 1.03, 1],
                      }
                    : { opacity: 1, y: 0, scale: 1 }
                }
                exit={{ opacity: 0, y: -4, scale: 0.96 }}
                transition={
                  status === "running"
                    ? { duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }
                    : { duration: 0.16, ease: "easeInOut" }
                }
              >
                {statusLabels[status]}
              </motion.span>
            </AnimatePresence>
          </header>

          <footer className="strawberry-node__footer">
            <span className="strawberry-node__language">{formatLanguage(data.language)}</span>
            <WorkerAssignmentSelect nodeId={data.id} value={data.assignedWorker} className="worker-select--node" />
          </footer>

          <Handle type="source" position={Position.Right} className="strawberry-node__handle" />
        </motion.article>
      ) : null}
    </AnimatePresence>
  );
}
