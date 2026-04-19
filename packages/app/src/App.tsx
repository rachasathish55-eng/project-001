import { useEffect, useState } from "react";
import Canvas from "./components/Editor/Canvas";
import NotebookView from "./components/NotebookView";
import TerminalPanel from "./components/TerminalPanel";
import WorkerDashboard from "./components/WorkerDashboard";
import { WorkerManagerProvider } from "./lib/worker-manager-context";
import { WorkerManager } from "./lib/worker-manager";
import { useStore } from "./store/useStore";

export default function App() {
  const [viewMode, setViewMode] = useState<"canvas" | "notebook">("canvas");
  const [manager, setManager] = useState<WorkerManager | null>(null);
  const nodes = useStore((state) => state.nodes);
  const edges = useStore((state) => state.edges);
  const workers = useStore((state) => state.workers);
  const workerStats = useStore((state) => state.workerStats);
  const connectionState = useStore((state) => state.connectionState);

  useEffect(() => {
    const nextManager = new WorkerManager();
    setManager(nextManager);

    return () => {
      nextManager.dispose();
    };
  }, []);

  return (
    <WorkerManagerProvider manager={manager}>
      <main className="app-shell">
        <header className="app-header">
          <div className="app-header__copy">
            <p className="app-eyebrow">Strawberry Studios</p>
            <h1 className="app-title">Notebook and canvas editor</h1>
            <p className="app-description">
              Switch between the flow canvas and a vertical notebook while staying synced to the worker daemon.
            </p>
          </div>

          <div className="app-statusbar">
            <div className={`app-pill app-pill--${connectionState}`}>
              <span>Connection</span>
              <strong>{connectionState}</strong>
            </div>
            <div className="app-pill">
              <span>Nodes</span>
              <strong>{nodes.length}</strong>
            </div>
            <div className="app-pill">
              <span>Edges</span>
              <strong>{edges.length}</strong>
            </div>
            <div className="app-pill">
              <span>Workers</span>
              <strong>{workers.length}</strong>
            </div>
            <div className="app-pill">
              <span>Telemetry</span>
              <strong>
                {workerStats
                  ? `${workerStats.cpuPct.toFixed(1)}% CPU / ${workerStats.memPct.toFixed(1)}% MEM`
                  : "waiting"}
              </strong>
            </div>
          </div>

          <div className="app-switcher" role="tablist" aria-label="Workspace view">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "canvas"}
              className={`app-switcher__tab${viewMode === "canvas" ? " app-switcher__tab--active" : ""}`}
              onClick={() => setViewMode("canvas")}
            >
              Canvas
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "notebook"}
              className={`app-switcher__tab${viewMode === "notebook" ? " app-switcher__tab--active" : ""}`}
              onClick={() => setViewMode("notebook")}
            >
              Notebook
            </button>
          </div>
        </header>

        <section className="workspace-shell">
          <WorkerDashboard />

          <section className="workspace-main">
            {viewMode === "canvas" ? (
              <section className="editor-shell">
                <aside className="editor-sidebar">
                  <span className="editor-sidebar__label">Canvas</span>
                  <h2>Flow-based notebook editing</h2>
                  <p>
                    Each node is draggable, connectable, and mirrors live status from the Claw Worker daemon.
                  </p>
                  <ul>
                    <li>Left handle = incoming data</li>
                    <li>Right handle = outgoing data</li>
                    <li>Status badges update in real time</li>
                  </ul>
                </aside>

                <div className="editor-canvas">
                  <Canvas />
                </div>
              </section>
            ) : (
              <section className="notebook-shell">
                <NotebookView />
              </section>
            )}

            <TerminalPanel />
          </section>
        </section>
      </main>
    </WorkerManagerProvider>
  );
}
