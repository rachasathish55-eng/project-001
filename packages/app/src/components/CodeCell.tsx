import { useEffect, useMemo, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import type { StrawberryNode } from "@strawberry/shared";
import { useWorkerManager } from "../lib/worker-manager-context";
import { useStore } from "../store/useStore";

function formatOutput(node: StrawberryNode): { text: string; tone: "output" | "error" | "empty" } {
  if (node.lastError) {
    return { text: node.lastError, tone: "error" };
  }

  if (node.lastOutput) {
    return { text: node.lastOutput, tone: "output" };
  }

  return { text: "Run this cell to see output here.", tone: "empty" };
}

export default function CodeCell({ nodeId }: { nodeId: string }) {
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
  }, [node?.code]);

  if (!node) {
    return null;
  }

  const handleRun = () => {
    updateNode(nodeId, {
      status: "queued",
      lastError: null,
    });
    manager?.exec(nodeId, node.code);
  };

  return (
    <article className={`code-cell code-cell--${node.status}`}>
      <header className="code-cell__header">
        <div>
          <span className="code-cell__eyebrow">Script cell</span>
          <h3 className="code-cell__title">{node.name}</h3>
        </div>

        <div className="code-cell__controls">
          <span className={`code-cell__status code-cell__status--${node.status}`}>{node.status}</span>
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
    </article>
  );
}
