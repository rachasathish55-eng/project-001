import { useEffect, useRef } from "react";
import { WorkerManager } from "./lib/worker-manager";
import { useStore } from "./store/useStore";

export default function App() {
  const nodes = useStore((state) => state.nodes);
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
      <section className="card">
        <p className="eyebrow">Strawberry Studios</p>
        <h1>Worker bridge online</h1>
        <p className="description">The React shell is now wired to the Claw Worker daemon.</p>

        <div className="status-grid">
          <div>
            <span className="status-label">Connection</span>
            <strong>{connectionState}</strong>
          </div>
          <div>
            <span className="status-label">Nodes</span>
            <strong>{nodes.length}</strong>
          </div>
          <div>
            <span className="status-label">Telemetry</span>
            <strong>{workerStats ? `${workerStats.cpuPct.toFixed(1)}% CPU / ${workerStats.memPct.toFixed(1)}% MEM` : "waiting"}</strong>
          </div>
        </div>
      </section>
    </main>
  );
}
