import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import type { StrawberryNode } from "@strawberry/shared";
import { useWorkerManager } from "../lib/worker-manager-context";
import { useStore } from "../store/useStore";
import WorkerAssignmentSelect from "./WorkerAssignmentSelect";

const codeMirrorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--bg-surface)",
      color: "var(--text-main)",
    },
    ".cm-scroller": {
      backgroundColor: "var(--bg-surface)",
    },
    ".cm-content": {
      caretColor: "var(--accent)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--bg-panel)",
      color: "var(--text-subtle)",
      borderRight: "1px solid var(--border-color)",
    },
    ".cm-activeLine, .cm-activeLineGutter": {
      backgroundColor: "var(--bg-panel-alt)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--accent)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "var(--accent-soft) !important",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--bg-panel)",
      border: "1px solid var(--border-color)",
      color: "var(--text-main)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--bg-panel-alt)",
      color: "var(--text-main)",
    },
  },
  { dark: true },
);

function formatOutput(node: StrawberryNode): { text: string; tone: "output" | "error" | "empty" } {
  if (node.lastError) {
    return { text: node.lastError, tone: "error" };
  }

  if (node.lastOutput) {
    return { text: node.lastOutput, tone: "output" };
  }

  return { text: "Run this cell to see output here.", tone: "empty" };
}

export default function NotebookCell({ nodeId }: { nodeId: string }) {
  const node = useStore((state) => state.nodes.find((entry) => entry.id === nodeId) ?? null);
  const updateNode = useStore((state) => state.updateNode);
  const manager = useWorkerManager();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  const output = useMemo(() => (node ? formatOutput(node) : null), [node]);

  useEffect(() => {
    if (!node || !hostRef.current || viewRef.current) {
      return;
    }

    const view = new EditorView({
      state: EditorState.create({
        doc: node.code,
        extensions: [
          python(),
          oneDark,
          codeMirrorTheme,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) {
              return;
            }

            const nextCode = update.state.doc.toString();
            updateNode(nodeId, { code: nextCode });
          }),
        ],
      }),
      parent: hostRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [node?.id, nodeId, updateNode]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !node) {
      return;
    }

    const currentCode = view.state.doc.toString();
    if (currentCode === node.code) {
      return;
    }

    view.dispatch({
      changes: {
        from: 0,
        to: currentCode.length,
        insert: node.code,
      },
    });
  }, [node?.code, node]);

  if (!node) {
    return null;
  }

  const handleRun = () => {
    updateNode(nodeId, {
      status: "queued",
      lastError: null,
    });

    try {
      manager?.exec(nodeId, node.code, node.assignedWorker);
    } catch (error) {
      updateNode(nodeId, {
        status: "error",
        lastError: error instanceof Error ? error.message : "Failed to start worker execution.",
      });
    }
  };

  return (
    <motion.article className={`code-cell code-cell--${node.status}`} layout>
      <header className="code-cell__header">
        <div>
          <span className="code-cell__eyebrow">Script cell</span>
          <h3 className="code-cell__title">{node.name}</h3>
        </div>

        <div className="code-cell__controls">
          <WorkerAssignmentSelect nodeId={nodeId} value={node.assignedWorker} className="worker-select--compact" />
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={node.status}
              className={`code-cell__status code-cell__status--${node.status}`}
              initial={{ opacity: 0, y: 4, scale: 0.96 }}
              animate={
                node.status === "running"
                  ? {
                      opacity: [0.94, 1, 0.94],
                      scale: [1, 1.03, 1],
                    }
                  : { opacity: 1, y: 0, scale: 1 }
              }
              exit={{ opacity: 0, y: -4, scale: 0.96 }}
              transition={
                node.status === "running"
                  ? { duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }
                  : { duration: 0.16, ease: "easeInOut" }
              }
            >
              {node.status}
            </motion.span>
          </AnimatePresence>
          <button type="button" className="code-cell__run" onClick={handleRun} disabled={!manager}>
            Run
          </button>
        </div>
      </header>

      <div className="code-cell__editor" ref={hostRef} />

      <section className={`code-cell__output code-cell__output--${output?.tone ?? "empty"}`} aria-live="polite">
        <span className="code-cell__output-label">Output</span>
        <pre className="code-cell__output-text">{output?.text ?? ""}</pre>
      </section>
    </motion.article>
  );
}
