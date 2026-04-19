import { useEffect, useRef } from "react";
import Canvas from "./components/Editor/Canvas";
import TerminalPanel from "./components/TerminalPanel";
import WorkerDashboard from "./components/WorkerDashboard";
import { WorkerManager } from "./lib/worker-manager";
import { useStore } from "./store/useStore";

export default function App() {
  const nodes = useStore((state) => state.nodes);
  const edges = useStore((state) => state.edges);
  const workers = useStore((state) => state.workers);
  const workerStats = useStore((state) => state.workerStats);
  const connectionState = useStore((state) => state.connectionState);
  const managerRef = useRef<WorkerManager | null>(null);

  useEffect(() => {
    managerRef.current = new WorkerManager();

    return () => {
      managerRef.current?.dispose();
      managerRef.current = null;
    };
  }, []);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="app-eyebrow">Strawberry Studios</p>
          <h1 className="app-title">Strawberry node editor</h1>
          <p className="app-description">
            Visualize notebook cells as connected StrawberryNodes and keep them synced with the worker daemon.
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
      </header>

      <section className="workspace-shell">
        <WorkerDashboard />

        <section className="workspace-main">
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

          <TerminalPanel />
        </section>
      </section>
    </main>
  );
}
